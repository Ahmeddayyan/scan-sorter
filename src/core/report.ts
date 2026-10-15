import { hammingDistance } from './hash';
import { formatPageNumber, pageNumberKey } from './pageNumber';
import type {
  DocumentReport,
  DuplicateIssue,
  DuplicatePair,
  LowConfidenceEntry,
  MissingRange,
  NumberingStyle,
  PageAssignment,
  PageId,
  PageRecord,
  ReportNote,
  SequenceInfo,
} from './types';

export interface ReportInput {
  /** Active pages keyed by id. */
  pages: ReadonlyMap<PageId, PageRecord>;
  order: readonly PageId[];
  assignments: Readonly<Record<PageId, PageAssignment>>;
  sequences: readonly SequenceInfo[];
  detectedTotal: number | null;
  duplicateHashThreshold: number;
  lowConfidenceThreshold: number;
  manualOrder: boolean;
  removedCount: number;
}

/** Inclusive ranges of integers in [lo, hi] that are not in `present`. */
export function missingRanges(style: NumberingStyle, lo: number, hi: number, present: ReadonlySet<number>): MissingRange[] {
  const out: MissingRange[] = [];
  let start: number | null = null;
  for (let v = lo; v <= hi + 1; v += 1) {
    const absent = v <= hi && !present.has(v);
    if (absent && start === null) start = v;
    if (!absent && start !== null) {
      out.push({ style, from: start, to: v - 1, count: v - start });
      start = null;
    }
  }
  return out;
}

function clusterByHash(ids: readonly PageId[], pages: ReadonlyMap<PageId, PageRecord>, threshold: number): { clusters: PageId[][]; pairs: DuplicatePair[] } {
  const parent = new Map<PageId, PageId>(ids.map((id) => [id, id]));
  const find = (id: PageId): PageId => {
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    return cur;
  };
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i]!;
      const b = ids[j]!;
      const ha = pages.get(a)?.perceptualHash ?? null;
      const hb = pages.get(b)?.perceptualHash ?? null;
      const distance = ha && hb ? hammingDistance(ha, hb) : null;
      pairs.push({ a, b, distance });
      if (distance !== null && distance <= threshold) parent.set(find(a), find(b));
    }
  }
  const groups = new Map<PageId, PageId[]>();
  for (const id of ids) {
    const root = find(id);
    const list = groups.get(root);
    if (list) list.push(id);
    else groups.set(root, [id]);
  }
  return { clusters: [...groups.values()], pairs };
}

export function buildReport(input: ReportInput): DocumentReport {
  const { pages, order, assignments, sequences, detectedTotal } = input;
  const notes: ReportNote[] = [];

  // ---- missing numbers ----
  const missing: MissingRange[] = [];
  for (const seq of sequences) {
    const present = new Set<number>();
    for (const id of order) {
      const n = assignments[id]?.number;
      if (n && n.style === seq.style) present.add(n.value);
    }
    const useTotal = seq.style === 'arabic' && detectedTotal !== null;
    const lo = useTotal ? 1 : seq.min;
    const hi = useTotal ? Math.max(detectedTotal, seq.max) : seq.max;
    missing.push(...missingRanges(seq.style, lo, hi, present));
    if (seq.startsAboveOne) {
      notes.push({
        kind: 'starts-above-one',
        style: seq.style,
        value: seq.min,
        message:
          seq.style === 'roman'
            ? `Front matter numbering starts at ${formatPageNumber({ style: 'roman', value: seq.min })}; earlier pages are not reported as missing.`
            : `Numbering starts at ${seq.min}. If this is an excerpt that is expected; pages 1–${seq.min - 1} are not reported as missing.`,
      });
    }
  }
  if (detectedTotal !== null) {
    notes.push({
      kind: 'total-detected',
      style: 'arabic',
      value: detectedTotal,
      message: `Pages are numbered "of ${detectedTotal}"; gaps are checked against 1–${detectedTotal}.`,
    });
    const arabic = sequences.find((s) => s.style === 'arabic');
    if (arabic && arabic.max < detectedTotal) {
      notes.push({
        kind: 'trailing-missing',
        style: 'arabic',
        value: detectedTotal - arabic.max,
        message: `The last numbered page is ${arabic.max} but the document says "of ${detectedTotal}": ${detectedTotal - arabic.max} trailing page(s) appear to be missing.`,
      });
    }
  }

  // ---- duplicates ----
  const groups = new Map<string, PageId[]>();
  for (const id of order) {
    const n = assignments[id]?.number;
    if (!n) continue;
    const key = pageNumberKey(n);
    const list = groups.get(key);
    if (list) list.push(id);
    else groups.set(key, [id]);
  }
  const duplicates: DuplicateIssue[] = [];
  for (const [, ids] of groups) {
    if (ids.length < 2) continue;
    const { clusters, pairs } = clusterByHash(ids, pages, input.duplicateHashThreshold);
    const rank = (id: PageId): number => {
      const a = assignments[id]!;
      return (a.source === 'manual' ? 10 : 0) + a.confidence;
    };
    const best = (members: readonly PageId[]): PageId =>
      [...members].sort((a, b) => rank(b) - rank(a) || pages.get(a)!.inputIndex - pages.get(b)!.inputIndex)[0]!;
    const safeToRemove: PageId[] = [];
    const clusterKeepers: PageId[] = [];
    for (const cluster of clusters) {
      const keeper = best(cluster);
      clusterKeepers.push(keeper);
      for (const id of cluster) if (id !== keeper) safeToRemove.push(id);
    }
    duplicates.push({
      number: assignments[ids[0]!]!.number!,
      pageIds: [...ids],
      kind: clusters.length === 1 ? 'duplicate-scan' : 'conflict',
      safeToRemove: order.filter((id) => safeToRemove.includes(id)),
      keep: best(clusterKeepers),
      pairs,
    });
  }
  duplicates.sort((a, b) => a.number.style.localeCompare(b.number.style) || a.number.value - b.number.value);

  // ---- unnumbered / low confidence ----
  const unnumbered = order.filter((id) => assignments[id]?.number === null);
  const lowConfidence: LowConfidenceEntry[] = [];
  for (const id of order) {
    const a = assignments[id]!;
    if (a.number !== null && a.source !== 'manual' && a.confidence < input.lowConfidenceThreshold) {
      lowConfidence.push({ pageId: id, number: a.number, confidence: a.confidence, reason: a.reason });
    }
  }

  // ---- notes ----
  const numbered = order.length - unnumbered.length;
  if (input.manualOrder) {
    notes.push({ kind: 'manual-order', message: 'Manual order is active; pages are no longer re-sorted automatically.' });
  }
  if (order.length > 0 && numbered === 0) {
    notes.push({ kind: 'no-numbers-found', message: 'No page numbers were found. Pages are shown in input order.' });
  }
  if (sequences.some((s) => s.style === 'roman') && sequences.some((s) => s.style === 'arabic')) {
    notes.push({ kind: 'front-matter', message: 'Roman-numbered front matter was detected and placed before the arabic-numbered pages.' });
  }

  return {
    missing,
    duplicates,
    unnumbered,
    lowConfidence,
    notes,
    summary: {
      pages: order.length,
      numbered,
      unnumbered: unnumbered.length,
      missing: missing.reduce((sum, r) => sum + r.count, 0),
      duplicates: duplicates.length,
      lowConfidence: lowConfidence.length,
      removed: input.removedCount,
    },
  };
}
