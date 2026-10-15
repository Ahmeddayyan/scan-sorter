import { describe, expect, it } from 'vitest';
import { EMPTY_OVERRIDES } from '../constants';
import { inferDocument } from '../inference';
import type { InferenceResult, PageRecord } from '../types';
import { flipBits, footerPages, hashFor, makePages, numberedPage, shuffle, type PageSpec } from './helpers';

/** Assigned numeric values in display order (null for unnumbered). */
function orderedValues(result: InferenceResult): (number | null)[] {
  return result.order.map((id) => result.assignments[id]!.number?.value ?? null);
}

function slotLabels(result: InferenceResult): string[] {
  return result.slots.map((s) => (s.kind === 'page' ? s.pageId : `gap ${s.from.value}-${s.to.value}`));
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('inferDocument - basic documents', () => {
  it('sorts a shuffled, cleanly numbered document', () => {
    const labels = shuffle(range(1, 20).map(String));
    const pages = footerPages(labels);
    const result = inferDocument(pages);

    expect(orderedValues(result)).toEqual(range(1, 20));
    expect(result.report.missing).toEqual([]);
    expect(result.report.duplicates).toEqual([]);
    expect(result.report.unnumbered).toEqual([]);
    expect(result.report.lowConfidence).toEqual([]);
    expect(result.slots.every((s) => s.kind === 'page')).toBe(true);
    expect(result.layout?.dominantRegions).toEqual(['bottom-center']);
    expect(result.layout?.alternating).toBe(false);
    expect(result.sequences).toEqual([{ style: 'arabic', min: 1, max: 20, count: 20, total: null, startsAboveOne: false }]);
    for (const id of result.order) {
      const a = result.assignments[id]!;
      expect(a.confidence).toBeGreaterThanOrEqual(0.6);
      expect(a.source).toBe('text-layer');
      expect(a.flags).toEqual([]);
    }
    expect(result.report.summary).toEqual({ pages: 20, numbered: 20, unnumbered: 0, missing: 0, duplicates: 0, lowConfidence: 0, removed: 0 });
  });

  it('is deterministic', () => {
    const pages = footerPages(shuffle(range(1, 15).map(String), 7));
    expect(inferDocument(pages)).toEqual(inferDocument(pages));
  });

  it('handles empty input', () => {
    const result = inferDocument([]);
    expect(result.order).toEqual([]);
    expect(result.slots).toEqual([]);
    expect(result.assignments).toEqual({});
    expect(result.sequences).toEqual([]);
    expect(result.layout).toBeNull();
    expect(result.report.summary.pages).toBe(0);
    expect(result.report.notes).toEqual([]);
  });

  it('reports a missing middle page with a gap tile', () => {
    const pages = footerPages(shuffle(['1', '2', '3', '4', '5', '6', '8', '9', '10']));
    const result = inferDocument(pages);
    expect(orderedValues(result)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10]);
    expect(result.report.missing).toEqual([{ style: 'arabic', from: 7, to: 7, count: 1 }]);
    const labels = slotLabels(result);
    expect(labels[6]).toBe('gap 7-7');
    expect(result.slots[6]).toMatchObject({ kind: 'gap', count: 1 });
    expect(result.report.summary.missing).toBe(1);
  });

  it('merges consecutive missing numbers into one range/tile', () => {
    const pages = footerPages(['1', '2', '7', '8']);
    const result = inferDocument(pages);
    expect(result.report.missing).toEqual([{ style: 'arabic', from: 3, to: 6, count: 4 }]);
    expect(slotLabels(result)).toEqual(['p0', 'p1', 'gap 3-6', 'p2', 'p3']);
  });

  it('detects trailing missing pages from "Page N of M"', () => {
    const pages = footerPages(shuffle(range(1, 9).map((n) => `Page ${n} of 12`)));
    const result = inferDocument(pages);
    expect(result.detectedTotal).toBe(12);
    expect(orderedValues(result)).toEqual(range(1, 9));
    expect(result.report.missing).toEqual([{ style: 'arabic', from: 10, to: 12, count: 3 }]);
    expect(slotLabels(result).at(-1)).toBe('gap 10-12');
    expect(result.report.notes.map((n) => n.kind)).toEqual(expect.arrayContaining(['total-detected', 'trailing-missing']));
    expect(result.assignments[result.order[0]!]!.total).toBe(12);
  });

  it('reports leading pages missing when a total is known, but only a soft note otherwise', () => {
    const withTotal = inferDocument(footerPages(['5 / 8', '6 / 8', '7 / 8', '8 / 8']));
    expect(withTotal.report.missing).toEqual([{ style: 'arabic', from: 1, to: 4, count: 4 }]);
    expect(slotLabels(withTotal)[0]).toBe('gap 1-4');
    expect(withTotal.report.notes.some((n) => n.kind === 'starts-above-one')).toBe(false);

    const excerpt = inferDocument(footerPages(['39', '37', '38', '40']));
    expect(excerpt.report.missing).toEqual([]);
    expect(excerpt.slots.every((s) => s.kind === 'page')).toBe(true);
    expect(excerpt.report.notes.map((n) => n.kind)).toContain('starts-above-one');
    expect(excerpt.sequences[0]!.startsAboveOne).toBe(true);
  });

  it('rejects an "of M" total that is smaller than the numbers seen', () => {
    const result = inferDocument(footerPages(['1 of 2', '2 of 2', '3', '4']));
    expect(result.detectedTotal).toBeNull();
    expect(result.report.missing).toEqual([]);
  });
});

describe('inferDocument - duplicates', () => {
  it('separates duplicate scans (near-identical hash) from conflicting reads', () => {
    const specs: PageSpec[] = [
      ...['1', '2', '3', '4', '5', '6'].map((l) => numberedPage(l)),
      // the same sheet scanned twice: hash within threshold
      { ...numberedPage('4'), hash: flipBits(hashFor(3), 3) },
    ];
    const result = inferDocument(makePages(specs));
    expect(result.report.duplicates).toHaveLength(1);
    const dup = result.report.duplicates[0]!;
    expect(dup.kind).toBe('duplicate-scan');
    expect(dup.number).toEqual({ value: 4, style: 'arabic' });
    expect(dup.pageIds).toEqual(['p3', 'p6']);
    expect(dup.keep).toBe('p3');
    expect(dup.safeToRemove).toEqual(['p6']);
    expect(dup.pairs[0]!.distance).toBe(3);
    expect(result.assignments.p3!.flags).toContain('duplicate');
    expect(result.assignments.p6!.flags).toContain('duplicate');
    expect(orderedValues(result)).toEqual([1, 2, 3, 4, 4, 5, 6]);
    // nothing missing: the duplicate does not create a gap
    expect(result.report.missing).toEqual([]);
  });

  it('flags a conflict when different pages read the same number and nothing explains it', () => {
    const specs: PageSpec[] = [...['1', '2', '3', '4', '5'].map((l) => numberedPage(l)), { ...numberedPage('3'), hash: hashFor(99) }];
    const result = inferDocument(makePages(specs));
    expect(result.report.duplicates).toHaveLength(1);
    const dup = result.report.duplicates[0]!;
    expect(dup.kind).toBe('conflict');
    expect(dup.safeToRemove).toEqual([]);
    expect(dup.pageIds).toEqual(['p2', 'p5']);
    expect(dup.pairs[0]!.distance).toBeGreaterThan(10);
  });

  it('treats missing hashes as a conflict to check', () => {
    const specs: PageSpec[] = [{ ...numberedPage('1'), hash: null }, { ...numberedPage('1'), hash: null }];
    const result = inferDocument(makePages(specs));
    expect(result.report.duplicates[0]!.kind).toBe('conflict');
    expect(result.report.duplicates[0]!.pairs[0]!.distance).toBeNull();
  });

  it('resolves a conflict by a one-character OCR fix that fills a gap', () => {
    // Page 7 was read as "1" at low confidence; the real page 1 exists.
    const specs: PageSpec[] = [
      ...['1', '2', '3', '4', '5', '6', '8', '9', '10'].map((l) => numberedPage(l)),
      { id: 'seven', texts: [{ text: '1', at: 'bottom-center', confidence: 0.55 }] },
    ];
    const result = inferDocument(makePages(specs));
    const seven = result.assignments.seven!;
    expect(seven.number).toEqual({ value: 7, style: 'arabic' });
    expect(seven.flags).toEqual(expect.arrayContaining(['misread-corrected', 'low-confidence']));
    expect(seven.confidence).toBeLessThanOrEqual(0.5);
    expect(result.report.duplicates).toEqual([]);
    expect(result.report.missing).toEqual([]);
    expect(orderedValues(result)).toEqual(range(1, 10));
  });

  it('resolves a conflict by falling back to another candidate on the page', () => {
    // p5 really is page 6: its footer was misread "3" but its header carries "6".
    const specs: PageSpec[] = [
      ...['1', '2', '3', '4', '5'].map((l) => numberedPage(l)),
      { texts: [{ text: '3', at: 'bottom-center', confidence: 0.6 }, { text: '6', at: 'top-right', confidence: 0.9 }], hash: hashFor(50) },
    ];
    const result = inferDocument(makePages(specs));
    expect(result.assignments.p5!.number?.value).toBe(6);
    expect(result.assignments.p5!.flags).toContain('alternative-chosen');
    expect(result.report.duplicates).toEqual([]);
  });
});

describe('inferDocument - numbering styles', () => {
  it('places roman front matter before the arabic body', () => {
    const labels = shuffle(['i', 'ii', 'iii', 'iv', ...range(1, 8).map(String)]);
    const result = inferDocument(footerPages(labels));
    const ordered = result.order.map((id) => result.assignments[id]!.number!);
    expect(ordered.map((n) => `${n.style}:${n.value}`)).toEqual([
      'roman:1',
      'roman:2',
      'roman:3',
      'roman:4',
      ...range(1, 8).map((n) => `arabic:${n}`),
    ]);
    expect(result.sequences.map((s) => s.style)).toEqual(['roman', 'arabic']);
    expect(result.report.missing).toEqual([]);
    expect(result.report.notes.map((n) => n.kind)).toContain('front-matter');
  });

  it('reports roman gaps separately', () => {
    const result = inferDocument(footerPages(['i', 'ii', 'iv', '1', '2']));
    expect(result.report.missing).toEqual([{ style: 'roman', from: 3, to: 3, count: 1 }]);
    expect(slotLabels(result)).toEqual(['p0', 'p1', 'gap 3-3', 'p2', 'p3', 'p4']);
    expect(result.slots[2]).toMatchObject({ from: { style: 'roman', value: 3 } });
  });
});

describe('inferDocument - OCR noise', () => {
  it('corrects an out-of-range misread when exactly one one-character fix fills a gap', () => {
    const labels = range(1, 20).map(String);
    labels[16] = '77'; // page 17 read as 77
    const specs = labels.map((l) => ({ texts: [{ text: l, at: 'bottom-center' as const, confidence: 0.85 }] }));
    const result = inferDocument(makePages(shuffle(specs)));
    expect(orderedValues(result)).toEqual(range(1, 20));
    const fixed = result.order[16]!;
    const a = result.assignments[fixed]!;
    expect(a.number?.value).toBe(17);
    expect(a.flags).toContain('misread-corrected');
    expect(a.flags).toContain('low-confidence');
    expect(a.confidence).toBeLessThanOrEqual(0.5);
    expect(a.reason).toContain('77');
    expect(result.report.lowConfidence.map((e) => e.pageId)).toEqual([fixed]);
    expect(result.report.missing).toEqual([]);
  });

  it('leaves an out-of-range read unnumbered (with suggestions) when the fix is ambiguous', () => {
    const labels = range(1, 30).map(String);
    labels[16] = '77'; // 17 and 27 are both candidates once 27 is also missing
    labels.splice(26, 1);
    const specs = labels.map((l) => ({ texts: [{ text: l, at: 'bottom-center' as const, confidence: 0.85 }] }));
    const result = inferDocument(makePages(specs));
    const odd = Object.values(result.assignments).find((a) => a.number === null)!;
    expect(odd).toBeDefined();
    expect(odd.flags).toEqual(expect.arrayContaining(['unnumbered', 'out-of-range']));
    expect(odd.suggestions.map((s) => s.value)).toEqual([17, 27]);
    expect(odd.reason).toMatch(/77/);
    expect(result.report.unnumbered).toEqual([odd.pageId]);
  });

  it('drops a wild outlier (e.g. 350) without inventing a number', () => {
    const labels = [...range(1, 10).map(String), '350'];
    const result = inferDocument(makePages(labels.map((l) => ({ texts: [{ text: l, at: 'bottom-center' as const, confidence: 0.8 }] }))));
    expect(result.assignments.p10!.number).toBeNull();
    expect(result.assignments.p10!.flags).toContain('out-of-range');
    expect(result.report.unnumbered).toEqual(['p10']);
    // stays attached after page 10 (its input predecessor)
    expect(result.order.at(-1)).toBe('p10');
  });

  it('accepts a weak letters-only read ("S" -> 5) when 5 is the only gap', () => {
    const labels = range(1, 12).map(String);
    labels[4] = 'S';
    const result = inferDocument(makePages(labels.map((l) => ({ texts: [{ text: l, at: 'bottom-center' as const, confidence: 0.8 }] }))));
    expect(result.assignments.p4!.number?.value).toBe(5);
    expect(result.assignments.p4!.flags).toContain('low-confidence');
    expect(result.assignments.p4!.reason).toMatch(/weak read "S"/);
    expect(orderedValues(result)).toEqual(range(1, 12));
  });

  it('down-weights a number that exceeds the detected total', () => {
    const labels = range(1, 8).map((n) => `Page ${n} of 8`);
    const specs: PageSpec[] = labels.map((l) => ({ texts: [{ text: l, at: 'bottom-center', confidence: 0.9 }] }));
    specs.push({ texts: [{ text: '18', at: 'bottom-center', confidence: 0.9 }] }); // page 1 read as 18 (no "of")
    const result = inferDocument(makePages(specs));
    expect(result.detectedTotal).toBe(8);
    expect(result.assignments.p8!.number).toBeNull();
  });
});

describe('inferDocument - decoys and layout', () => {
  it('ignores years, copyright lines and dates in footers', () => {
    const specs: PageSpec[] = shuffle(range(1, 12)).map((n) => ({
      texts: [
        { text: '© 2019 Acme Corporation', at: 'bottom-left', split: true },
        { text: String(n), at: 'bottom-center' },
        { text: 'Printed 12/03/2019', at: 'bottom-right', split: true },
      ],
    }));
    const result = inferDocument(makePages(specs));
    expect(orderedValues(result)).toEqual(range(1, 12));
    expect(result.report.duplicates).toEqual([]);
    expect(result.detectedTotal).toBeNull();
    for (const id of result.order) expect(result.assignments[id]!.number!.value).toBeLessThan(13);
  });

  it('ignores chapter numbers in running headers and does not number a page from them', () => {
    const specs: PageSpec[] = range(1, 10).map((n) => ({
      texts: [
        { text: 'Chapter 3', at: 'top-left' },
        { text: '3 Methods and Materials', at: 'top-right' },
        ...(n === 6 ? [] : [{ text: String(n), at: 'bottom-center' as const }]),
      ],
    }));
    const result = inferDocument(makePages(specs));
    // page 6 lost its footer: it must not become "3"
    expect(result.assignments.p5!.number).toBeNull();
    expect(result.report.unnumbered).toEqual(['p5']);
    expect(result.report.missing).toEqual([{ style: 'arabic', from: 6, to: 6, count: 1 }]);
    expect(result.report.duplicates).toEqual([]);
    expect(orderedValues(result)).toEqual([1, 2, 3, 4, 5, null, 7, 8, 9, 10]);
  });

  it('detects alternating corners in book scans and uses parity to reject decoys', () => {
    const specs: PageSpec[] = range(1, 12).map((n) => {
      const side = n % 2 === 1 ? 'bottom-right' : 'bottom-left';
      const texts = [{ text: String(n), at: side as 'bottom-right' | 'bottom-left', confidence: 0.95 }];
      // decoys that are locally slightly stronger but sit on the wrong side for their parity
      if (n === 5) texts.push({ text: '8', at: 'bottom-right', confidence: 1 });
      if (n === 10) texts.push({ text: '3', at: 'bottom-left', confidence: 1 });
      return { texts };
    });
    const result = inferDocument(makePages(shuffle(specs, 3)));
    expect(result.layout?.alternating).toBe(true);
    expect(result.layout?.oddSide).toBe('right');
    expect(result.layout?.dominantRegions.sort()).toEqual(['bottom-left', 'bottom-right']);
    expect(orderedValues(result)).toEqual(range(1, 12));
    expect(result.report.duplicates).toEqual([]);
  });

  it('prefers the dominant region when a page has numbers in two places', () => {
    const specs: PageSpec[] = range(1, 10).map((n) => ({ texts: [{ text: String(n), at: 'top-right' }] }));
    // page 4 also has an unrelated "9" in the footer
    specs[3]!.texts!.push({ text: '9', at: 'bottom-center' });
    const result = inferDocument(makePages(specs));
    expect(result.assignments.p3!.number?.value).toBe(4);
    expect(result.assignments.p3!.suggestions.map((s) => s.value)).toContain(9);
    expect(result.layout?.dominantRegions).toEqual(['top-right']);
  });
});

describe('inferDocument - unnumbered pages and overrides', () => {
  it('keeps unnumbered pages attached after their input predecessor', () => {
    const specs: PageSpec[] = [
      { id: 'a', ...numberedPage('3') },
      { id: 'u1', texts: [] },
      { id: 'b', ...numberedPage('1') },
      { id: 'c', ...numberedPage('2') },
      { id: 'u2', texts: [] },
      { id: 'u3', texts: [{ text: 'Notes', at: 'top-left' }] },
      { id: 'd', ...numberedPage('5') },
    ];
    const result = inferDocument(makePages(specs));
    expect(result.order).toEqual(['b', 'c', 'u2', 'u3', 'a', 'u1', 'd']);
    expect(result.report.unnumbered).toEqual(['u2', 'u3', 'u1']);
    expect(slotLabels(result)).toEqual(['b', 'c', 'u2', 'u3', 'a', 'u1', 'gap 4-4', 'd']);
    expect(result.assignments.u2!.flags).toEqual(['unnumbered']);
    expect(result.assignments.u2!.reason).toMatch(/no text/);
    expect(result.assignments.u3!.reason).toMatch(/no page number/);
    expect(result.report.summary.unnumbered).toBe(3);
  });

  it('puts leading unnumbered pages first', () => {
    const result = inferDocument(makePages([{ id: 'u0', texts: [] }, { id: 'a', ...numberedPage('2') }, { id: 'b', ...numberedPage('1') }]));
    expect(result.order).toEqual(['u0', 'b', 'a']);
  });

  it('treats pending pages (no evidence yet) as unnumbered', () => {
    const pages: PageRecord[] = makePages([{ ...numberedPage('2') }, { ...numberedPage('1') }, { status: 'pending', texts: [] }]);
    const result = inferDocument(pages);
    // the pending page stays attached after its input predecessor (page "1")
    expect(result.order).toEqual(['p1', 'p2', 'p0']);
    expect(result.assignments.p2!.number).toBeNull();
  });

  it('applies manual numbers with confidence 1 and re-sorts', () => {
    const pages = footerPages(['1', '2', '3', '4', '3']); // p4 really is page 6
    const overrides = { ...EMPTY_OVERRIDES, numbers: { p4: { value: 6, style: 'arabic' as const } } };
    const result = inferDocument(pages, { overrides });
    expect(result.assignments.p4).toMatchObject({ number: { value: 6, style: 'arabic' }, confidence: 1, source: 'manual', flags: ['manual'] });
    expect(orderedValues(result)).toEqual([1, 2, 3, 4, 6]);
    expect(result.report.duplicates).toEqual([]);
    expect(result.report.missing).toEqual([{ style: 'arabic', from: 5, to: 5, count: 1 }]);
  });

  it('lets the user force a page to be unnumbered', () => {
    const pages = footerPages(['1', '2', '2', '3']);
    const result = inferDocument(pages, { overrides: { ...EMPTY_OVERRIDES, numbers: { p2: null } } });
    expect(result.assignments.p2!.number).toBeNull();
    expect(result.assignments.p2!.flags).toEqual(['manual', 'unnumbered']);
    expect(result.order).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(result.report.duplicates).toEqual([]);
    expect(result.report.unnumbered).toEqual(['p2']);
  });

  it('excludes removed pages everywhere', () => {
    const specs: PageSpec[] = [...['1', '2', '3'].map((l) => numberedPage(l)), { ...numberedPage('2'), hash: flipBits(hashFor(1), 2) }];
    const pages = makePages(specs);
    const before = inferDocument(pages);
    expect(before.report.duplicates[0]!.safeToRemove).toEqual(['p3']);
    const after = inferDocument(pages, { overrides: { ...EMPTY_OVERRIDES, removed: ['p3'] } });
    expect(after.order).toEqual(['p0', 'p1', 'p2']);
    expect(after.assignments.p3).toBeUndefined();
    expect(after.report.duplicates).toEqual([]);
    expect(after.report.summary.removed).toBe(1);
  });

  it('respects a manual order and suspends automatic sorting', () => {
    const pages = footerPages(['1', '2', '3', '5']);
    const result = inferDocument(pages, { overrides: { ...EMPTY_OVERRIDES, manualOrder: ['p3', 'p0'] } });
    expect(result.manualOrder).toBe(true);
    expect(result.order).toEqual(['p3', 'p0', 'p1', 'p2']);
    expect(result.slots.every((s) => s.kind === 'page')).toBe(true);
    expect(result.report.notes.map((n) => n.kind)).toContain('manual-order');
    // numbers and the report are still computed
    expect(result.report.missing).toEqual([{ style: 'arabic', from: 4, to: 4, count: 1 }]);
  });

  it('manual numbers participate in duplicate detection', () => {
    const pages = footerPages(['1', '2', '3']);
    const result = inferDocument(pages, { overrides: { ...EMPTY_OVERRIDES, numbers: { p2: { value: 2, style: 'arabic' } } } });
    expect(result.report.duplicates).toHaveLength(1);
    expect(result.report.duplicates[0]!.keep).toBe('p2'); // manual wins
  });
});

describe('inferDocument - scale', () => {
  it('handles a 300-page OCR-style document quickly', () => {
    const specs: PageSpec[] = shuffle(range(1, 300), 11).map((n) => ({
      texts: [
        { text: 'Chapter 7', at: 'top-left', split: true, confidence: 0.9 },
        { text: `${n}`, at: n % 2 === 0 ? 'bottom-left' : 'bottom-right', split: true, confidence: 0.75 + (n % 7) / 40 },
        { text: '© 2021 Example Press', at: 'bottom-center', split: true, confidence: 0.8 },
      ],
    }));
    const t0 = performance.now();
    const pages = makePages(specs);
    const t1 = performance.now();
    const result = inferDocument(pages);
    const t2 = performance.now();
    expect(orderedValues(result)).toEqual(range(1, 300));
    expect(result.report.duplicates).toEqual([]);
    expect(result.report.missing).toEqual([]);
    expect(result.layout?.alternating).toBe(true);
    expect(t2 - t1).toBeLessThan(500);
    expect(t1 - t0).toBeLessThan(3000);
  });
});
