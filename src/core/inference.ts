import {
  DEFAULT_DUPLICATE_HASH_THRESHOLD,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  DEFAULT_MIN_ACCEPT_SCORE,
  EMPTY_OVERRIDES,
  PAGE_REGIONS,
} from './constants';
import { digitVariants } from './confusions';
import { regionBand, regionSide } from './geometry';
import { isNearDuplicate } from './hash';
import { buildOrder, buildSlots } from './order';
import { formatPageNumber, pageNumberKey, samePageNumber } from './pageNumber';
import { buildReport } from './report';
import type {
  AssignmentFlag,
  InferenceOptions,
  InferenceResult,
  LayoutProfile,
  NumberingStyle,
  PageAssignment,
  PageId,
  PageNumber,
  PageNumberCandidate,
  PageRecord,
  PageRegion,
  SequenceInfo,
} from './types';

// ---------------------------------------------------------------------------
// Internal working structures
// ---------------------------------------------------------------------------

interface Scored {
  cand: PageNumberCandidate;
  /** Single-page score from extraction. */
  local: number;
  /** Score after cross-page adjustments (region, range, parity, total). */
  adj: number;
  rangeFactor: number;
}

interface Work {
  page: PageRecord;
  /** `undefined` = no override; `null` = user forced "no number". */
  manual: PageNumber | null | undefined;
  scored: Scored[];
  chosen: Scored | null;
  number: PageNumber | null;
  /** Adjusted score of the final pick (drives confidence). */
  pickScore: number;
  flags: Set<AssignmentFlag>;
  notes: string[];
  suggestions: PageNumber[];
  corrected: boolean;
  alternative: boolean;
}

interface Range {
  lo: number;
  hi: number;
}

type Ranges = Record<NumberingStyle, Range | null>;

/** Cost (in score units) of each missing number inside the dominant interval. */
const INTERVAL_GAP_PENALTY = 0.15;
/** Minimum summed vote weight for an "of M" total to be believed. */
const MIN_TOTAL_VOTES = 0.5;
/** Weak candidates below this local score are never used for gap filling. */
const MIN_GAP_FILL_LOCAL = 0.2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assign one page number (or none) to every active page so that the whole document is
 * consistent, then derive order, grid slots and the report.
 *
 * Deterministic: the same pages + overrides always give the same result. Cheap enough
 * to re-run on every page update and on every user edit (hundreds of pages in a few ms).
 *
 * Steps:
 *  1. local best candidate per page (manual overrides are fixed up-front);
 *  2. document layout profile (dominant region(s), odd/even alternation) and dominant
 *     numeric range per style (interval maximising score minus gap penalty), plus "of M" total;
 *  3. re-score every candidate with region / range / parity / total factors and pick again;
 *  4. gap filling: unnumbered pages get a weak in-range candidate or a single-character
 *     OCR-confusion variant when exactly one such value fills a gap; pages whose number
 *     collides with a different-looking page try an alternative candidate or variant;
 *  5. confidence, flags, order (stable attachment of unnumbered pages), slots, report.
 */
export function inferDocument(allPages: readonly PageRecord[], options: InferenceOptions = {}): InferenceResult {
  const overrides = options.overrides ?? EMPTY_OVERRIDES;
  const duplicateHashThreshold = options.duplicateHashThreshold ?? DEFAULT_DUPLICATE_HASH_THRESHOLD;
  const lowConfidenceThreshold = options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const minAccept = options.minAcceptScore ?? DEFAULT_MIN_ACCEPT_SCORE;
  const correctMisreads = options.correctMisreads ?? true;
  const manualOrder = overrides.manualOrder !== null;

  const removed = new Set(overrides.removed);
  const pages = allPages
    .filter((p) => !removed.has(p.id))
    .sort((a, b) => a.inputIndex - b.inputIndex || compareIds(a.id, b.id));
  const removedCount = allPages.length - pages.length;

  const works: Work[] = pages.map((page) => ({
    page,
    manual: Object.hasOwn(overrides.numbers, page.id) ? overrides.numbers[page.id] : undefined,
    scored: page.candidates.map((cand) => ({ cand, local: cand.score, adj: cand.score, rangeFactor: 1 })),
    chosen: null,
    number: null,
    pickScore: 0,
    flags: new Set<AssignmentFlag>(),
    notes: [],
    suggestions: [],
    corrected: false,
    alternative: false,
  }));

  // ---- pass 1: local best ------------------------------------------------
  for (const w of works) {
    if (w.manual !== undefined) {
      w.number = w.manual;
      continue;
    }
    const best = argmax(w.scored, (s) => s.local);
    w.chosen = best;
    w.number = best ? best.cand.number : null;
    w.pickScore = best ? best.local : 0;
  }

  const layout1 = buildLayout(works, 0.5);
  const ranges = computeRanges(works);
  const total1 = detectTotal(works, maxArabic(works));

  // ---- pass 2: cross-page adjusted scores ---------------------------------
  for (const w of works) {
    if (w.manual !== undefined) continue;
    for (const s of w.scored) {
      s.rangeFactor = rangeFactor(s.cand.number, ranges);
      s.adj =
        s.local *
        regionFactor(layout1, s.cand.region) *
        s.rangeFactor *
        parityFactor(layout1, s.cand) *
        totalFactor(total1, s.cand.number);
    }
    const best = argmax(w.scored, (s) => s.adj);
    if (best && best.adj >= minAccept) {
      w.chosen = best;
      w.number = best.cand.number;
      w.pickScore = best.adj;
    } else {
      w.chosen = null;
      w.number = null;
      w.pickScore = 0;
      if (best) {
        const r = ranges[best.cand.number.style];
        const why = best.rangeFactor < 0.5 && r ? `outside the document range ${r.lo}–${r.hi}` : 'too weak to trust';
        w.notes.push(`read "${best.cand.rawText}" in ${best.cand.region} but ${why}`);
        if (best.rangeFactor < 0.5) w.flags.add('out-of-range');
      }
    }
  }

  // ---- pass 3: gap filling, misread correction, conflict resolution -------
  const assigned = new Map<string, Work[]>();
  const addAssigned = (w: Work): void => {
    if (!w.number) return;
    const key = pageNumberKey(w.number);
    const list = assigned.get(key);
    if (list) list.push(w);
    else assigned.set(key, [w]);
  };
  const removeAssigned = (w: Work): void => {
    if (!w.number) return;
    const key = pageNumberKey(w.number);
    const list = assigned.get(key);
    if (!list) return;
    const idx = list.indexOf(w);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) assigned.delete(key);
  };
  for (const w of works) addAssigned(w);

  const arabicRange = ranges.arabic;
  if (arabicRange) {
    for (const w of works) {
      if (w.manual !== undefined || w.number !== null || w.scored.length === 0) continue;
      const weak = w.scored.filter((s) => s.local >= MIN_GAP_FILL_LOCAL);
      // (a) a weak candidate whose own value is in range and fills a gap
      const own = ownValueOptions(weak, arabicRange, assigned);
      if (own.size === 1) {
        const [value, s] = [...own.entries()][0]!;
        assign(w, s, { value, style: 'arabic' }, Math.min(0.5, s.adj > 0 ? s.adj : s.local * 0.6));
        w.notes.push(`weak read "${s.cand.rawText}" accepted because ${value} is otherwise missing`);
        addAssigned(w);
        continue;
      }
      if (own.size > 1) {
        w.suggestions = sortedNumbers(own.keys());
        continue;
      }
      // (b) single-character OCR confusion variants
      if (!correctMisreads) continue;
      const variants = variantOptions(weak, arabicRange, assigned);
      if (variants.size === 1) {
        const [value, s] = [...variants.entries()][0]!;
        assign(w, s, { value, style: 'arabic' }, Math.min(0.5, s.local * 0.6));
        w.corrected = true;
        w.flags.add('misread-corrected');
        w.notes.push(`"${s.cand.rawText}" corrected to ${value} (one-character OCR fix that fills a gap)`);
        addAssigned(w);
      } else if (variants.size > 1) {
        w.suggestions = sortedNumbers(variants.keys());
      }
    }
  }

  const keys = [...assigned.keys()].sort(compareKeys);
  for (const key of keys) {
    const group = assigned.get(key);
    if (!group || group.length < 2) continue;
    const keeper = pickKeeper(group);
    for (const m of [...group]) {
      if (m === keeper || m.manual !== undefined || !m.number || !m.chosen) continue;
      const nearAnother = group.some(
        (o) => o !== m && isNearDuplicate(m.page.perceptualHash, o.page.perceptualHash, duplicateHashThreshold) === true,
      );
      if (nearAnother) continue; // genuine duplicate scan: keep the number, the report marks it safe to remove

      const previousRaw = m.chosen.cand.rawText;
      // (1) another candidate on this page that is acceptable and free
      let alt: Scored | null = null;
      for (const s of m.scored) {
        if (s === m.chosen || s.adj < minAccept) continue;
        if (samePageNumber(s.cand.number, m.number)) continue;
        if (assigned.has(pageNumberKey(s.cand.number))) continue;
        if (!alt || s.adj > alt.adj) alt = s;
      }
      if (alt) {
        removeAssigned(m);
        assign(m, alt, alt.cand.number, alt.adj * 0.8);
        m.alternative = true;
        m.flags.add('alternative-chosen');
        m.notes.push(`"${previousRaw}" collided with another page; used "${alt.cand.rawText}" instead`);
        addAssigned(m);
        continue;
      }
      // (2) a one-character confusion variant that fills a gap
      if (correctMisreads && arabicRange && m.number.style === 'arabic') {
        const variants = variantOptions([m.chosen], arabicRange, assigned);
        if (variants.size === 1) {
          const [value, s] = [...variants.entries()][0]!;
          removeAssigned(m);
          assign(m, s, { value, style: 'arabic' }, Math.min(0.5, s.adj * 0.6));
          m.corrected = true;
          m.flags.add('misread-corrected');
          m.notes.push(`"${previousRaw}" collided with another page; corrected to ${value} (one-character OCR fix that fills a gap)`);
          addAssigned(m);
          continue;
        }
        if (variants.size > 1) m.suggestions = sortedNumbers(variants.keys());
      }
    }
  }

  // ---- finalise -------------------------------------------------------------
  const layout = buildLayout(works, minAccept);
  const detectedTotal = detectTotal(works, maxArabic(works));
  const sequences = buildSequences(works, detectedTotal);
  const numbers = new Map<PageId, PageNumber | null>(works.map((w) => [w.page.id, w.number]));
  const order = buildOrder(pages, numbers, overrides.manualOrder);
  const slots = buildSlots(order, numbers, detectedTotal, manualOrder);

  const assignments: Record<PageId, PageAssignment> = {};
  for (const w of works) assignments[w.page.id] = finalizeAssignment(w, layout, ranges, lowConfidenceThreshold);

  const report = buildReport({
    pages: new Map(pages.map((p) => [p.id, p])),
    order,
    assignments,
    sequences,
    detectedTotal,
    duplicateHashThreshold,
    lowConfidenceThreshold,
    manualOrder,
    removedCount,
  });
  for (const issue of report.duplicates) {
    for (const id of issue.pageIds) {
      const a = assignments[id]!;
      if (!a.flags.includes('duplicate')) a.flags.push('duplicate');
    }
  }

  return { order, assignments, slots, report, sequences, layout, detectedTotal, manualOrder };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareKeys(a: string, b: string): number {
  // "roman:4" before "arabic:1"; then numeric.
  const [sa, va] = a.split(':') as [NumberingStyle, string];
  const [sb, vb] = b.split(':') as [NumberingStyle, string];
  if (sa !== sb) return sa === 'roman' ? -1 : 1;
  return Number.parseInt(va, 10) - Number.parseInt(vb, 10);
}

function argmax<T>(items: readonly T[], score: (item: T) => number): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

function assign(w: Work, s: Scored, number: PageNumber, pickScore: number): void {
  w.chosen = s;
  w.number = number;
  w.pickScore = pickScore;
}

function sortedNumbers(values: Iterable<number>): PageNumber[] {
  return [...values]
    .sort((a, b) => a - b)
    .slice(0, 3)
    .map((value) => ({ value, style: 'arabic' as const }));
}

function maxArabic(works: readonly Work[]): number {
  let max = 0;
  for (const w of works) if (w.number && w.number.style === 'arabic') max = Math.max(max, w.number.value);
  return max;
}

/** Keep manual pages, then the strongest pick, then text-layer over OCR, then earliest input. */
function pickKeeper(group: readonly Work[]): Work {
  return [...group].sort((a, b) => {
    const ma = a.manual !== undefined ? 1 : 0;
    const mb = b.manual !== undefined ? 1 : 0;
    if (ma !== mb) return mb - ma;
    if (a.pickScore !== b.pickScore) return b.pickScore - a.pickScore;
    const ta = a.page.evidence.source === 'text-layer' ? 1 : 0;
    const tb = b.page.evidence.source === 'text-layer' ? 1 : 0;
    if (ta !== tb) return tb - ta;
    return a.page.inputIndex - b.page.inputIndex;
  })[0]!;
}

// ---- layout -----------------------------------------------------------------

function buildLayout(works: readonly Work[], minScore: number): LayoutProfile | null {
  const entries = works.filter(
    (w): w is Work & { chosen: Scored; number: PageNumber } =>
      w.manual === undefined && w.chosen !== null && w.number !== null && w.pickScore >= minScore,
  );
  if (entries.length < 3) return null;

  const counts = Object.fromEntries(PAGE_REGIONS.map((r) => [r, 0])) as Record<PageRegion, number>;
  for (const e of entries) counts[e.chosen.cand.region] += 1;
  const regionShare = Object.fromEntries(
    PAGE_REGIONS.map((r) => [r, counts[r] / entries.length]),
  ) as Record<PageRegion, number>;

  let alternating = false;
  let oddSide: 'left' | 'right' | null = null;
  let altBand: 'top' | 'bottom' | null = null;
  for (const band of ['bottom', 'top'] as const) {
    const left = entries.filter((e) => e.chosen.cand.region === `${band}-left`);
    const right = entries.filter((e) => e.chosen.cand.region === `${band}-right`);
    const n = left.length + right.length;
    if (left.length < 2 || right.length < 2 || n < 0.5 * entries.length) continue;
    const isOdd = (e: { number: PageNumber }): boolean => e.number.value % 2 === 1;
    const oddRight = right.filter(isOdd).length + left.filter((e) => !isOdd(e)).length;
    const oddLeft = n - oddRight;
    if (oddRight / n >= 0.8) {
      alternating = true;
      oddSide = 'right';
      altBand = band;
      break;
    }
    if (oddLeft / n >= 0.8) {
      alternating = true;
      oddSide = 'left';
      altBand = band;
      break;
    }
  }

  let dominantRegions: PageRegion[];
  if (alternating && altBand) {
    dominantRegions = ([`${altBand}-left`, `${altBand}-right`] as PageRegion[]).sort(
      (a, b) => regionShare[b] - regionShare[a],
    );
  } else {
    const sorted = PAGE_REGIONS.filter((r) => regionShare[r] > 0).sort((a, b) => regionShare[b] - regionShare[a]);
    const top = regionShare[sorted[0]!] ?? 0;
    dominantRegions = sorted.filter((r) => regionShare[r] >= 0.5 * top).slice(0, 2);
  }
  return { dominantRegions, alternating, oddSide, regionShare };
}

function effectiveShare(layout: LayoutProfile, region: PageRegion): number {
  if (layout.alternating && layout.dominantRegions.includes(region)) {
    const band = regionBand(region);
    if (band) return layout.regionShare[`${band}-left`] + layout.regionShare[`${band}-right`];
  }
  return layout.regionShare[region];
}

function regionFactor(layout: LayoutProfile | null, region: PageRegion): number {
  if (!layout) return 1;
  const max = Math.max(...PAGE_REGIONS.map((r) => effectiveShare(layout, r)));
  if (max <= 0) return 1;
  return 0.6 + 0.4 * (effectiveShare(layout, region) / max);
}

function parityFactor(layout: LayoutProfile | null, cand: PageNumberCandidate): number {
  if (!layout || !layout.alternating || !layout.oddSide) return 1;
  const altBand = regionBand(layout.dominantRegions[0]!);
  const band = regionBand(cand.region);
  const side = regionSide(cand.region);
  if (band !== altBand || side === null || side === 'center') return 1;
  const odd = cand.number.value % 2 === 1;
  return odd === (side === layout.oddSide) ? 1 : 0.5;
}

// ---- ranges and totals --------------------------------------------------------

/**
 * The interval of values that best explains the document: maximises the summed weight
 * of distinct values inside minus a penalty per missing number. Wild outliers (a "77" in
 * a 1..40 document, a stray "2019") fall outside; moderate gaps stay inside.
 */
function dominantInterval(entries: readonly { value: number; weight: number }[]): Range | null {
  if (entries.length === 0) return null;
  const gain = new Map<number, number>();
  for (const e of entries) gain.set(e.value, Math.max(gain.get(e.value) ?? 0, e.weight));
  const values = [...gain.keys()].sort((a, b) => a - b);
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1]! + gain.get(v)!);
  let best = -Infinity;
  let bi = 0;
  let bj = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i; j < values.length; j += 1) {
      const sum = prefix[j + 1]! - prefix[i]!;
      const span = values[j]! - values[i]! + 1;
      const present = j - i + 1;
      const score = sum - INTERVAL_GAP_PENALTY * (span - present);
      if (score > best + 1e-9) {
        best = score;
        bi = i;
        bj = j;
      }
    }
  }
  return { lo: values[bi]!, hi: values[bj]! };
}

function computeRanges(works: readonly Work[]): Ranges {
  const entries: Record<NumberingStyle, { value: number; weight: number }[]> = { arabic: [], roman: [] };
  for (const w of works) {
    if (w.manual) entries[w.manual.style].push({ value: w.manual.value, weight: 1 });
    else if (w.manual === undefined && w.chosen) {
      entries[w.chosen.cand.number.style].push({ value: w.chosen.cand.number.value, weight: w.chosen.local });
    }
  }
  return { arabic: dominantInterval(entries.arabic), roman: dominantInterval(entries.roman) };
}

function rangeFactor(number: PageNumber, ranges: Ranges): number {
  const r = ranges[number.style];
  if (!r) return 1;
  const span = Math.max(r.hi - r.lo + 1, 10);
  const d = number.value < r.lo ? r.lo - number.value : number.value > r.hi ? number.value - r.hi : 0;
  if (d === 0) return 1;
  return Math.max(0.1, 1 - d / span);
}

function totalFactor(total: number | null, number: PageNumber): number {
  return total !== null && number.style === 'arabic' && number.value > total ? 0.3 : 1;
}

/** Weighted vote over the "of M" totals of the chosen candidates; rejected when below the largest number. */
function detectTotal(works: readonly Work[], maxValue: number): number | null {
  const votes = new Map<number, number>();
  for (const w of works) {
    if (w.manual !== undefined || !w.chosen || w.chosen.cand.total === null) continue;
    votes.set(w.chosen.cand.total, (votes.get(w.chosen.cand.total) ?? 0) + w.chosen.local);
  }
  let best: number | null = null;
  let bestVotes = 0;
  for (const total of [...votes.keys()].sort((a, b) => a - b)) {
    const v = votes.get(total)!;
    if (v > bestVotes) {
      best = total;
      bestVotes = v;
    }
  }
  if (best === null || bestVotes < MIN_TOTAL_VOTES || best < maxValue) return null;
  return best;
}

function buildSequences(works: readonly Work[], detectedTotal: number | null): SequenceInfo[] {
  const out: SequenceInfo[] = [];
  for (const style of ['roman', 'arabic'] as const) {
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    for (const w of works) {
      if (!w.number || w.number.style !== style) continue;
      min = Math.min(min, w.number.value);
      max = Math.max(max, w.number.value);
      count += 1;
    }
    if (count === 0) continue;
    const total = style === 'arabic' ? detectedTotal : null;
    out.push({ style, min, max, count, total, startsAboveOne: min > 1 && total === null });
  }
  return out;
}

// ---- gap filling -----------------------------------------------------------

function isFree(value: number, assigned: ReadonlyMap<string, Work[]>): boolean {
  return !assigned.has(pageNumberKey({ value, style: 'arabic' }));
}

/** Candidates' own values that are in range and not yet used, best candidate per value. */
function ownValueOptions(scored: readonly Scored[], range: Range, assigned: ReadonlyMap<string, Work[]>): Map<number, Scored> {
  const out = new Map<number, Scored>();
  for (const s of scored) {
    if (s.cand.number.style !== 'arabic') continue;
    const v = s.cand.number.value;
    if (v < range.lo || v > range.hi || !isFree(v, assigned)) continue;
    const existing = out.get(v);
    if (!existing || s.local > existing.local) out.set(v, s);
  }
  return out;
}

/** One-character confusion variants of the candidates' values that are in range and free. */
function variantOptions(scored: readonly Scored[], range: Range, assigned: ReadonlyMap<string, Work[]>): Map<number, Scored> {
  const out = new Map<number, Scored>();
  for (const s of scored) {
    if (s.cand.number.style !== 'arabic') continue;
    for (const v of digitVariants(String(s.cand.number.value))) {
      const n = Number.parseInt(v, 10);
      if (n < range.lo || n > range.hi || !isFree(n, assigned)) continue;
      const existing = out.get(n);
      if (!existing || s.local > existing.local) out.set(n, s);
    }
  }
  return out;
}

// ---- final assignment ------------------------------------------------------

const PATTERN_LABEL: Record<PageNumberCandidate['pattern'], string> = {
  bare: 'bare number',
  'page-word': '"Page N"',
  'page-of': '"Page N of M"',
  'slash-total': '"N / M"',
  dashed: '"- N -"',
  bracketed: 'bracketed number',
  roman: 'roman numeral',
  'edge-of-text': 'number at the edge of a text line',
};

function finalizeAssignment(w: Work, layout: LayoutProfile | null, ranges: Ranges, lowThreshold: number): PageAssignment {
  const pageId = w.page.id;
  if (w.manual !== undefined) {
    return {
      pageId,
      number: w.manual,
      total: null,
      confidence: 1,
      source: 'manual',
      reason: w.manual ? `set to ${formatPageNumber(w.manual)} by you` : 'marked as unnumbered by you',
      flags: w.manual ? ['manual'] : ['manual', 'unnumbered'],
      candidate: null,
      suggestions: [],
    };
  }

  if (!w.chosen || !w.number) {
    let reason: string;
    if (w.notes.length > 0) reason = w.notes.join('; ');
    else if (w.page.evidence.source === 'none') reason = 'no text found on this page';
    else if (w.scored.length === 0) reason = 'no page number found in the header or footer';
    else reason = 'no candidate was strong enough';
    return {
      pageId,
      number: null,
      total: null,
      confidence: 0,
      source: 'none',
      reason,
      flags: [...new Set<AssignmentFlag>(['unnumbered', ...w.flags])],
      candidate: null,
      suggestions: w.suggestions,
    };
  }

  const c = w.chosen;
  const others = w.scored.filter((s) => s !== c && !samePageNumber(s.cand.number, w.number));
  const second = others.reduce((m, s) => Math.max(m, s.adj), 0);
  const margin = w.pickScore > 0 ? Math.max(0, Math.min(1, (w.pickScore - second) / w.pickScore)) : 0;
  const source = w.page.evidence.source === 'text-layer' ? 'text-layer' : 'ocr';
  let confidence = w.pickScore * (0.75 + 0.25 * margin);
  confidence = Math.min(confidence, source === 'text-layer' ? 0.98 : 0.95);
  if (w.corrected || w.alternative) confidence = Math.min(confidence, 0.5);
  confidence = Math.round(confidence * 1000) / 1000;

  const flags = new Set<AssignmentFlag>(w.flags);
  if (confidence < lowThreshold) flags.add('low-confidence');
  if (c.rangeFactor < 0.5) flags.add('out-of-range');

  const parts: string[] = [`${PATTERN_LABEL[c.cand.pattern]} "${c.cand.rawText}" in ${c.cand.region}`];
  if (c.cand.misread) parts.push('letters read as digits');
  if (layout) {
    if (layout.dominantRegions.includes(c.cand.region)) parts.push('consistent with the document layout');
    else parts.push(`unusual position (numbers are usually in ${layout.dominantRegions.join(' / ')})`);
  }
  const r = ranges[w.number.style];
  if (c.rangeFactor < 1 && r) parts.push(`outside the usual range ${r.lo}–${r.hi}`);
  parts.push(...w.notes);

  // Runner-up with a different value is a useful suggestion for the correction UI.
  const suggestions: PageNumber[] = [...w.suggestions];
  const runnerUp = argmax(others, (s) => s.adj);
  if (runnerUp && runnerUp.adj >= 0.2 && !suggestions.some((n) => samePageNumber(n, runnerUp.cand.number))) {
    suggestions.push(runnerUp.cand.number);
  }

  return {
    pageId,
    number: w.number,
    total: c.cand.total,
    confidence,
    source,
    reason: parts.join('; '),
    flags: [...flags],
    candidate: c.cand,
    suggestions,
  };
}
