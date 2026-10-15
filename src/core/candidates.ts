import { DEFAULT_BANDS, MAX_PAGE_VALUE, MAX_ROMAN } from './constants';
import { confusableToDigits } from './confusions';
import { boxCenter, regionBand, regionOf, unionBoxes } from './geometry';
import { looksRoman, parseRoman } from './roman';
import { buildLines, tokenize, type Token } from './tokenize';
import type {
  BandConfig,
  CandidatePattern,
  ExtractionOptions,
  ExtractionResult,
  NormBox,
  PageEvidence,
  PageNumberCandidate,
  PageRegion,
  RejectReason,
  RejectedCandidate,
} from './types';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Words that introduce a page number: "Page 12", "p. 12", "Seite 12". */
const PAGE_WORDS: ReadonlySet<string> = new Set([
  'page',
  'pages',
  'pg',
  'pgs',
  'p',
  'pp',
  'seite',
  'pagina',
  'página',
  'pág',
  'pag',
  'folio',
  'fol',
  'sheet',
  'blatt',
  'str',
]);

/** "12 of 40", "12 / 40", "12 | 40". */
const TOTAL_SEPARATORS: ReadonlySet<string> = new Set(['of', '/', '|', '\\', 'de', 'von', 'sur', 'di', 'from']);

/**
 * Words that label a number as something other than a page number when they
 * immediately precede it: "Chapter 3", "Figure 4", "No. 12", "Room 101".
 */
const LABEL_WORDS: ReadonlySet<string> = new Set([
  'chapter', 'ch', 'chap', 'chapters',
  'section', 'sec', 'sect', '§', 'subsection',
  'figure', 'fig', 'figures', 'figs',
  'table', 'tbl', 'tables',
  'vol', 'volume', 'volumes',
  'no', 'nr', 'num', 'number', 'numbers', '#',
  'part', 'unit', 'lesson', 'step', 'week', 'day', 'room', 'suite', 'apt', 'floor', 'fl', 'bldg', 'building',
  'exercise', 'ex', 'problem', 'problems', 'question', 'questions', 'q', 'item', 'items', 'line', 'lines',
  'appendix', 'app', 'annex', 'article', 'art', 'rule', 'verse', 'psalm', 'grade', 'year', 'class', 'form',
  'level', 'stage', 'phase', 'round', 'issue', 'edition', 'ed', 'version', 'ver', 'v', 'rev', 'revision',
  'act', 'scene', 'book', 'bk', 'lecture', 'lect', 'module', 'mod', 'tutorial', 'homework', 'hw', 'assignment',
  'lab', 'quiz', 'exam', 'test', 'slide', 'note', 'notes', 'example', 'eg', 'theorem', 'thm', 'lemma',
  'definition', 'def', 'equation', 'eq', 'proposition', 'prop', 'claim', 'remark', 'corollary', 'cor',
  'box', 'plate', 'map', 'chart', 'graph', 'diagram', 'illustration', 'photo', 'image', 'listing',
  'algorithm', 'alg', 'program', 'procedure', 'protocol', 'schedule', 'clause', 'paragraph', 'para', '¶',
  'tab', 'invoice', 'order', 'ref', 'id', 'serial', 'model', 'phone', 'tel', 'fax', 'ext', 'mobile', 'cell',
  'zip', 'postcode', 'highway', 'route', 'rt', 'exit', 'gate', 'platform', 'track', 'bus', 'flight', 'seat',
  'row', 'col', 'column', 'bin', 'lot', 'batch', 'case', 'cat', 'catalog', 'catalogue', 'isbn', 'issn', 'doi',
  'pmid', 'ticket', 'account', 'acct', 'po', 'sku', 'ref#', 'reference', 'file', 'doc', 'document', 'page#',
  'age', 'aged', 'grades', 'size', 'sizes', 'width', 'height', 'depth', 'length', 'weight', 'qty', 'quantity',
  'count', 'total', 'sum', 'amount', 'score', 'scores', 'points', 'pts', 'mark', 'marks', 'x', '×', 'by',
  'since', 'until', 'till', 'from', 'to', 'at', 'in', 'on', 'than', 'over', 'under', 'about', 'approx',
  'top', 'best', 'first', 'last', 'every', 'each', 'per', 'only', 'nearly', 'almost', 'around', 'circa', 'ca',
]);

/** Units that follow a number and mark it as a measurement, time or percentage. */
const UNIT_WORDS: ReadonlySet<string> = new Set([
  '%', 'percent', 'pct', 'px', 'pt', 'pts', 'kg', 'g', 'mg', 'cm', 'mm', 'm', 'km', 'in', 'ft', 'lb', 'lbs',
  'oz', 'ml', 'l', 'mb', 'gb', 'kb', 'tb', 'hz', 'khz', 'mhz', 'ghz', 'am', 'pm', 'a.m', 'p.m', 'min', 'mins',
  'sec', 'secs', 's', 'h', 'hr', 'hrs', 'hour', 'hours', 'minute', 'minutes', 'second', 'seconds', 'days',
  'weeks', 'months', 'years', 'yrs', '°', '°c', '°f', 'c', 'f', 'k', 'x', '×', 'times', 'copies', 'people',
  'students', 'items', 'units', 'pcs', 'pieces', 'dpi', 'ppi', 'fps', 'mph', 'kph', 'rpm', 'v', 'w', 'kw', 'mw',
  'a', 'ma', 'mah', 'wh', 'kwh', 'cal', 'kcal', 'bpm', 'psi', 'bar', 'atm', 'mol', 'ppm', 'db', 'usd', 'eur',
  'gbp', 'dollars', 'euros', 'pounds', 'cents', 'pence', 'ms', 'ns', 'us', 'µs', 'bits', 'bytes', 'bit', 'byte',
  'th', 'st', 'nd', 'rd', 'o\'clock', 'oclock',
]);

const MONTHS: ReadonlySet<string> = new Set([
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june', 'jul', 'july',
  'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november', 'dec', 'december',
]);

const DASH_RE = /^[-‐-―_~]+$/;
const SEP_RE = /^[|/\\.·•:;,]+$/;
const COPYRIGHT_RE = /©|\(c\)|copyright|all rights reserved/i;
const DATE_RE = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})$/;
const PHONE_RE = /^\+?\d{2,4}[-.]\d{2,4}([-.]\d{2,4})?$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const PAGE_WORD_INLINE_RE = /^(page|pg|p|seite|pagina|página)\.?[:#]?(\d{1,4})$/i;
const INLINE_TOTAL_RE = /^(\d{1,4})\/(\d{1,4})$/;
const SPLIT_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;

// ---------------------------------------------------------------------------
// Scoring tables
// ---------------------------------------------------------------------------

const POSITION_SCORE: Record<PageRegion, number> = {
  'bottom-center': 1,
  'bottom-right': 0.95,
  'bottom-left': 0.95,
  'top-right': 0.85,
  'top-left': 0.85,
  'top-center': 0.8,
  body: 0.15,
};

const PATTERN_SCORE: Record<CandidatePattern, number> = {
  'page-of': 1,
  'page-word': 1,
  'slash-total': 0.95,
  dashed: 0.95,
  bare: 0.85,
  bracketed: 0.8,
  roman: 0.8,
  'edge-of-text': 0.6,
};

// ---------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------

type TokenKind = 'number' | 'roman' | 'sep' | 'word';

interface Parsed {
  token: Token;
  raw: string;
  prefix: string;
  core: string;
  suffix: string;
  lower: string;
  kind: TokenKind;
  value: number;
  digits: string;
  misread: boolean;
  pureLetters: boolean;
  inlineTotal: number | null;
  inlinePageWord: boolean;
}

function parseToken(token: Token): Parsed {
  const raw = token.text;
  const m = SPLIT_RE.exec(raw);
  const prefix = m?.[1] ?? '';
  const core = m?.[2] ?? raw;
  const suffix = m?.[3] ?? '';
  const base: Parsed = {
    token,
    raw,
    prefix,
    core,
    suffix,
    // Separators such as "/" or "|" have an empty core; match them on the raw text.
    lower: (core.length > 0 ? core : raw).toLowerCase(),
    kind: 'word',
    value: 0,
    digits: '',
    misread: false,
    pureLetters: false,
    inlineTotal: null,
    inlinePageWord: false,
  };
  if (core.length === 0) return { ...base, kind: 'sep' };
  if (/^\d{1,4}$/.test(core)) {
    return { ...base, kind: 'number', digits: core, value: Number.parseInt(core, 10) };
  }
  const inlineTotal = INLINE_TOTAL_RE.exec(core);
  if (inlineTotal) {
    return {
      ...base,
      kind: 'number',
      digits: inlineTotal[1]!,
      value: Number.parseInt(inlineTotal[1]!, 10),
      inlineTotal: Number.parseInt(inlineTotal[2]!, 10),
    };
  }
  const inlinePage = PAGE_WORD_INLINE_RE.exec(core);
  if (inlinePage) {
    return {
      ...base,
      kind: 'number',
      digits: inlinePage[2]!,
      value: Number.parseInt(inlinePage[2]!, 10),
      inlinePageWord: true,
    };
  }
  if (looksRoman(core)) {
    const value = parseRoman(core);
    if (value !== null) return { ...base, kind: 'roman', value };
  }
  if (/^[0-9A-Za-z|!]{1,4}$/.test(core)) {
    const conf = confusableToDigits(core);
    if (conf && conf.changed) {
      return {
        ...base,
        kind: 'number',
        digits: conf.digits,
        value: Number.parseInt(conf.digits, 10),
        misread: true,
        pureLetters: !/\d/.test(core),
      };
    }
  }
  if (DASH_RE.test(raw) || SEP_RE.test(raw)) return { ...base, kind: 'sep' };
  return base;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function edgeFactor(box: NormBox, region: PageRegion, bands: BandConfig): number {
  const band = regionBand(region);
  if (band === null) return 1;
  const cy = boxCenter(box).y;
  const bandHeight = band === 'top' ? bands.top : bands.bottom;
  const distance = band === 'top' ? cy : 1 - cy;
  return 1 - 0.15 * Math.min(1, Math.max(0, distance / bandHeight));
}

function fontFactor(height: number): number {
  if (height > 0.045) return 0.4; // display-size digits: chapter numbers, titles
  if (height > 0.03) return 0.75;
  return 1;
}

function confidenceFactor(confidence: number): number {
  return 0.5 + 0.5 * Math.min(1, Math.max(0, confidence));
}

function isDash(p: Parsed | undefined): boolean {
  return p !== undefined && p.kind === 'sep' && DASH_RE.test(p.raw);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Find every plausible page number on one page.
 *
 * Works on positioned words from either the PDF text layer or OCR: tokenises, groups
 * into lines and segments, matches the known page-number patterns, applies the
 * rejection rules (years, dates, phone numbers, labelled numbers, footnote markers, ...)
 * and scores each survivor by position, pattern, isolation, font size and text confidence.
 *
 * Pure and deterministic. The pipeline calls this once per page and stores the result in
 * `PageRecord.candidates`; inference then picks one candidate per page across the document.
 */
export function extractCandidates(evidence: PageEvidence, options: ExtractionOptions = {}): ExtractionResult {
  const bands = options.bands ?? DEFAULT_BANDS;
  const maxRoman = options.maxRoman ?? MAX_ROMAN;
  const maxValue = options.maxValue ?? MAX_PAGE_VALUE;
  const candidates: PageNumberCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  if (evidence.items.length === 0) return { candidates, rejected };

  const lines = buildLines(tokenize(evidence.items));

  for (const line of lines) {
    const heights = line.tokens.map((t) => t.box.h).sort((a, b) => a - b);
    const lineMedianHeight = heights[Math.floor(heights.length / 2)] ?? 0;
    const lineFirst = line.tokens[0];
    const lineLast = line.tokens[line.tokens.length - 1];

    for (const segment of line.segments) {
      const parsed = segment.tokens.map(parseToken);
      const segmentText = segment.text;
      const numericCount = parsed.filter((p) => p.kind === 'number').length;
      const hasLongDigits = parsed.some((p) => /\d{5,}/.test(p.raw));
      const hasPhoneLike = parsed.some((p) => PHONE_RE.test(p.core));
      const hasDateLike = parsed.some(
        (p) => DATE_RE.test(p.core) || TIME_RE.test(p.core) || MONTHS.has(p.lower),
      );
      const hasCopyright = COPYRIGHT_RE.test(segmentText);

      for (let k = 0; k < parsed.length; k += 1) {
        const p = parsed[k]!;
        if (p.kind !== 'number' && p.kind !== 'roman') continue;
        const region = regionOf(p.token.box, bands);
        const reject = (reason: RejectReason): void => {
          rejected.push({ rawText: p.raw, segmentText, box: p.token.box, region, reason });
        };
        const prev = parsed[k - 1];
        const prev2 = parsed[k - 2];
        const prev3 = parsed[k - 3];
        const next = parsed[k + 1];
        const next2 = parsed[k + 2];
        const next3 = parsed[k + 3];

        // The "40" of "12 of 40" / "12 out of 40" is a total, never the page number.
        if (p.kind === 'number' && prev && prev2?.kind === 'number' && TOTAL_SEPARATORS.has(prev.lower)) {
          reject('total-only');
          continue;
        }
        if (p.kind === 'number' && prev?.lower === 'of' && prev2?.lower === 'out' && prev3?.kind === 'number') {
          reject('total-only');
          continue;
        }

        // Segment-level rejections.
        if (hasLongDigits || hasPhoneLike || numericCount >= 3) {
          reject('number-cluster');
          continue;
        }
        if (hasDateLike) {
          reject('date');
          continue;
        }
        if (hasCopyright) {
          reject('copyright');
          continue;
        }
        if (line.tokens.length > 1 && p.token.box.h < 0.55 * lineMedianHeight) {
          reject('superscript');
          continue;
        }
        if (prev && prev.kind === 'word' && LABEL_WORDS.has(prev.lower)) {
          reject('labelled');
          continue;
        }
        if (/[#$€£¥]/.test(p.prefix)) {
          reject('unit');
          continue;
        }
        if (/[%°]/.test(p.suffix) || (next && next.kind === 'word' && UNIT_WORDS.has(next.lower)) || next?.raw.startsWith('%')) {
          reject('unit');
          continue;
        }

        // ---------------- roman ----------------
        if (p.kind === 'roman') {
          if (p.value > maxRoman) {
            reject('roman-too-large');
            continue;
          }
          const single = p.core.length === 1;
          if (single && !/^[ivx]$/i.test(p.core)) {
            reject('embedded');
            continue;
          }
          const used = new Set<number>([k]);
          if (prev && prev.kind === 'word' && PAGE_WORDS.has(prev.lower)) used.add(k - 1);
          if (isDash(prev) && isDash(next)) {
            used.add(k - 1);
            used.add(k + 1);
          }
          const isolated = parsed.every((q, i) => used.has(i) || q.kind === 'sep');
          if (!isolated) {
            reject('embedded');
            continue;
          }
          if (region === 'body') {
            reject('body-not-isolated');
            continue;
          }
          const upper = p.core === p.core.toUpperCase();
          const patternScore = (single ? 0.5 : 0.8) * (upper ? 0.9 : 1);
          const usedTokens = [...used].sort((a, b) => a - b).map((i) => segment.tokens[i]!);
          const textConfidence = Math.min(...usedTokens.map((t) => t.confidence));
          const score =
            POSITION_SCORE[region] *
            edgeFactor(p.token.box, region, bands) *
            patternScore *
            fontFactor(p.token.box.h) *
            confidenceFactor(textConfidence);
          candidates.push({
            number: { value: p.value, style: 'roman' },
            total: null,
            pattern: 'roman',
            rawText: usedTokens.map((t) => t.text).join(' '),
            segmentText,
            box: unionBoxes(usedTokens.map((t) => t.box)),
            region,
            isolated: true,
            misread: false,
            textConfidence,
            score: clamp01(score),
          });
          continue;
        }

        // ---------------- arabic ----------------
        if (p.value === 0) {
          reject('zero');
          continue;
        }
        if (p.value > maxValue) {
          reject('too-large');
          continue;
        }

        let pattern: CandidatePattern = 'bare';
        let total: number | null = null;
        const used = new Set<number>([k]);

        if (p.inlinePageWord) {
          pattern = 'page-word';
        } else if (prev && prev.kind === 'word' && PAGE_WORDS.has(prev.lower)) {
          pattern = 'page-word';
          used.add(k - 1);
        }

        if (p.inlineTotal !== null) {
          total = p.inlineTotal;
          pattern = pattern === 'page-word' ? 'page-of' : 'slash-total';
        } else if (next && next2 && next2.kind === 'number' && !next2.misread && TOTAL_SEPARATORS.has(next.lower)) {
          total = next2.value;
          used.add(k + 1);
          used.add(k + 2);
          pattern = pattern === 'page-word' ? 'page-of' : 'slash-total';
        } else if (next?.lower === 'out' && next2?.lower === 'of' && next3?.kind === 'number' && !next3.misread) {
          total = next3.value;
          used.add(k + 1);
          used.add(k + 2);
          used.add(k + 3);
          pattern = pattern === 'page-word' ? 'page-of' : 'slash-total';
        }
        if (total !== null && (total < p.value || total > maxValue)) total = null;

        if (pattern === 'bare') {
          const dashedInline = /[-‐-―]/.test(p.prefix) && /[-‐-―]/.test(p.suffix);
          if (dashedInline || (isDash(prev) && isDash(next))) {
            pattern = 'dashed';
            if (isDash(prev)) used.add(k - 1);
            if (isDash(next)) used.add(k + 1);
          } else if (/[([{]/.test(p.prefix) && /[)\]}]/.test(p.suffix)) {
            pattern = 'bracketed';
          }
        }

        if (
          p.digits.length === 4 &&
          p.value >= 1900 &&
          p.value <= 2100 &&
          pattern !== 'page-word' &&
          pattern !== 'page-of' &&
          pattern !== 'slash-total'
        ) {
          reject('year');
          continue;
        }

        const usedTokens = [...used].sort((a, b) => a - b).map((i) => segment.tokens[i]!);
        const isolated = parsed.every((q, i) => used.has(i) || q.kind === 'sep');
        if (!isolated) {
          const atEdge = usedTokens.includes(lineFirst!) || usedTokens.includes(lineLast!);
          if (!atEdge) {
            reject('embedded');
            continue;
          }
          if (region === 'body') {
            reject('body-not-isolated');
            continue;
          }
          if (pattern === 'bare' || pattern === 'bracketed') pattern = 'edge-of-text';
        } else if (region === 'body' && line.segments.length > 1) {
          reject('body-not-isolated');
          continue;
        }
        if (p.misread && (!isolated || region === 'body')) {
          reject('embedded');
          continue;
        }

        const textConfidence = Math.min(...usedTokens.map((t) => t.confidence));
        const digitsFactor = p.digits.length === 4 && pattern === 'bare' ? 0.7 : 1;
        const misreadFactor = p.misread ? (p.pureLetters ? 0.35 : 0.6) : 1;
        const score =
          POSITION_SCORE[region] *
          edgeFactor(p.token.box, region, bands) *
          PATTERN_SCORE[pattern] *
          fontFactor(p.token.box.h) *
          digitsFactor *
          misreadFactor *
          confidenceFactor(textConfidence);

        candidates.push({
          number: { value: p.value, style: 'arabic' },
          total,
          pattern,
          rawText: usedTokens.map((t) => t.text).join(' '),
          segmentText,
          box: unionBoxes(usedTokens.map((t) => t.box)),
          region,
          isolated,
          misread: p.misread,
          textConfidence,
          score: clamp01(score),
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.box.y - b.box.y || a.box.x - b.box.x);
  return { candidates, rejected };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
