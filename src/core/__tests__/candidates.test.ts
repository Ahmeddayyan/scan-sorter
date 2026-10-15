import { describe, expect, it } from 'vitest';
import { extractCandidates } from '../candidates';
import type { PageEvidence, PageRegion, TextItem } from '../types';
import { placeText, type PlacedText } from './helpers';

function evidence(texts: PlacedText[], source: PageEvidence['source'] = 'text-layer'): PageEvidence {
  const items: TextItem[] = texts.flatMap(placeText);
  return { source, bands: ['full'], items, hasTextLayer: source === 'text-layer' };
}

function extract(texts: PlacedText[]) {
  return extractCandidates(evidence(texts));
}

function values(texts: PlacedText[]): number[] {
  return extract(texts).candidates.map((c) => c.number.value);
}

describe('extractCandidates - patterns', () => {
  it('finds a bare integer in the footer', () => {
    const { candidates, rejected } = extract([{ text: '17', at: 'bottom-center' }]);
    expect(rejected).toEqual([]);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.number).toEqual({ value: 17, style: 'arabic' });
    expect(c.pattern).toBe('bare');
    expect(c.region).toBe('bottom-center');
    expect(c.isolated).toBe(true);
    expect(c.total).toBeNull();
    expect(c.score).toBeGreaterThan(0.8);
  });

  it.each([
    ['Page 12', 'page-word', null],
    ['page 12', 'page-word', null],
    ['p. 12', 'page-word', null],
    ['pg 12', 'page-word', null],
    ['pg. 12', 'page-word', null],
    ['Page12', 'page-word', null],
    ['Seite 12', 'page-word', null],
    ['Page 12 of 40', 'page-of', 40],
    ['Page 12 / 40', 'page-of', 40],
    ['12 of 40', 'slash-total', 40],
    ['12 / 40', 'slash-total', 40],
    ['12/40', 'slash-total', 40],
    ['12 | 40', 'slash-total', 40],
    ['12 out of 40', 'slash-total', 40],
    ['- 12 -', 'dashed', null],
    ['-12-', 'dashed', null],
    ['– 12 –', 'dashed', null],
    ['[12]', 'bracketed', null],
    ['(12)', 'bracketed', null],
  ] as [string, string, number | null][])(
    'recognises "%s"',
    (text, pattern, total) => {
      const { candidates } = extract([{ text, at: 'bottom-center' }]);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.number.value).toBe(12);
      expect(candidates[0]!.pattern).toBe(pattern);
      expect(candidates[0]!.total).toBe(total);
      expect(candidates[0]!.isolated).toBe(true);
    },
  );

  it('handles OCR-style split words the same as text-layer runs', () => {
    const { candidates } = extract([{ text: 'Page 12 of 40', at: 'bottom-center', split: true, confidence: 0.9 }]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.pattern).toBe('page-of');
    expect(candidates[0]!.total).toBe(40);
    expect(candidates[0]!.rawText).toBe('Page 12 of 40');
    expect(candidates[0]!.textConfidence).toBeCloseTo(0.9);
  });

  it('does not treat the total as a page number', () => {
    const { candidates, rejected } = extract([{ text: '12 of 40', at: 'bottom-center' }]);
    expect(candidates.map((c) => c.number.value)).toEqual([12]);
    expect(rejected.map((r) => r.reason)).toEqual(['total-only']);
  });

  it('drops an impossible total but keeps the number', () => {
    const { candidates } = extract([{ text: '12 / 3', at: 'bottom-center' }]);
    expect(candidates[0]!.number.value).toBe(12);
    expect(candidates[0]!.total).toBeNull();
  });

  it('recognises roman numerals', () => {
    for (const [text, value] of [
      ['iv', 4],
      ['xii', 12],
      ['XII', 12],
      ['Page iv', 4],
      ['- iv -', 4],
      ['i', 1],
      ['x', 10],
    ] as const) {
      const { candidates } = extract([{ text, at: 'bottom-center' }]);
      expect(candidates, text).toHaveLength(1);
      expect(candidates[0]!.number).toEqual({ value, style: 'roman' });
      expect(candidates[0]!.pattern).toBe('roman');
    }
    // single letters other than i/v/x and huge numerals are not page numbers
    expect(values([{ text: 'l', at: 'bottom-center' }]).filter((v) => v === 50)).toEqual([]);
    expect(extract([{ text: 'mix', at: 'bottom-center' }]).candidates).toEqual([]);
    expect(extract([{ text: 'did', at: 'bottom-center' }]).candidates).toEqual([]);
  });

  it('maps OCR-confusable letters to digits with a penalty', () => {
    const { candidates } = extract([{ text: '1O', at: 'bottom-center', confidence: 0.8 }]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.number.value).toBe(10);
    expect(candidates[0]!.misread).toBe(true);
    expect(candidates[0]!.rawText).toBe('1O');
    const clean = extract([{ text: '10', at: 'bottom-center', confidence: 0.8 }]).candidates[0]!;
    expect(candidates[0]!.score).toBeLessThan(clean.score);
    const pure = extract([{ text: 'S', at: 'bottom-center', confidence: 0.8 }]).candidates[0]!;
    expect(pure.number.value).toBe(5);
    expect(pure.score).toBeLessThan(candidates[0]!.score);
  });
});

describe('extractCandidates - rejections', () => {
  const rejectedReasons = (texts: PlacedText[]) => extract(texts).rejected.map((r) => r.reason);

  it('rejects years, copyright lines and dates', () => {
    expect(extract([{ text: '2019', at: 'bottom-center' }]).candidates).toEqual([]);
    expect(rejectedReasons([{ text: '2019', at: 'bottom-center' }])).toEqual(['year']);
    expect(extract([{ text: '© 2019 Acme Corp', at: 'bottom-left' }]).candidates).toEqual([]);
    expect(rejectedReasons([{ text: 'Copyright 2019 Acme', at: 'bottom-left' }])).toContain('copyright');
    expect(extract([{ text: '12/03/2019', at: 'bottom-right' }]).candidates).toEqual([]);
    expect(extract([{ text: 'March 12, 2019', at: 'bottom-right' }]).candidates).toEqual([]);
    expect(rejectedReasons([{ text: 'Printed 3 March 2019', at: 'bottom-right' }])).toContain('date');
    expect(extract([{ text: '12:30', at: 'bottom-right' }]).candidates).toEqual([]);
    // but "Page 2019 of 3000" is explicit
    expect(values([{ text: 'Page 2019 of 3000', at: 'bottom-center' }])).toEqual([2019]);
  });

  it('rejects phone numbers, ISBNs and other digit clusters', () => {
    expect(extract([{ text: 'Tel: 020 7946 0958', at: 'bottom-left' }]).candidates).toEqual([]);
    expect(rejectedReasons([{ text: 'Tel: 020 7946 0958', at: 'bottom-left' }])).toContain('number-cluster');
    expect(extract([{ text: '555-1234', at: 'bottom-left' }]).candidates).toEqual([]);
    expect(extract([{ text: 'ISBN 978-0-13-468599-1', at: 'bottom-left' }]).candidates).toEqual([]);
    expect(extract([{ text: 'Order 1234567', at: 'bottom-left' }]).candidates).toEqual([]);
  });

  it('rejects labelled numbers: chapters, figures, sections, tables', () => {
    for (const text of ['Chapter 3', 'CHAPTER 3', 'Figure 4', 'Fig. 4', 'Table 2', 'Section 2', 'Vol. 3', 'No. 7', 'Part 2', 'Room 101', 'Lecture 5', 'Exercise 3']) {
      expect(extract([{ text, at: 'top-left' }]).candidates, text).toEqual([]);
      expect(rejectedReasons([{ text, at: 'top-left' }]), text).toEqual(['labelled']);
    }
    expect(extract([{ text: 'Section 2.1', at: 'top-left' }]).candidates).toEqual([]);
    expect(extract([{ text: 'Chapter IV', at: 'top-left' }]).candidates).toEqual([]);
  });

  it('rejects units, prices and percentages', () => {
    for (const text of ['12%', '12 %', '$12', '€12', '12 kg', '12 pt', '#12', '12 pm']) {
      expect(extract([{ text, at: 'bottom-center' }]).candidates, text).toEqual([]);
    }
  });

  it('rejects footnote markers (superscripts) and numbers inside running text', () => {
    const items: PlacedText[] = [{ text: 'as shown in earlier work', at: { x: 0.3, y: 0.95 }, split: true }];
    const ev = evidence(items);
    ev.items.push({ text: '3', box: { x: 0.43, y: 0.942, w: 0.003, h: 0.005 }, confidence: 1 });
    const res = extractCandidates(ev);
    expect(res.candidates).toEqual([]);
    expect(res.rejected.map((r) => r.reason)).toContain('superscript');

    expect(extract([{ text: 'there are 12 reasons for this', at: 'bottom-center' }]).candidates).toEqual([]);
    expect(rejectedReasons([{ text: 'there are 12 reasons for this', at: 'bottom-center' }])).toEqual(['embedded']);
    expect(extract([{ text: 'there are 12 reasons for this', at: 'body' }]).candidates).toEqual([]);
  });

  it('rejects zero and oversized numbers', () => {
    expect(rejectedReasons([{ text: '0', at: 'bottom-center' }])).toEqual(['zero']);
    expect(extract([{ text: '12345', at: 'bottom-center' }]).candidates).toEqual([]);
  });
});

describe('extractCandidates - scoring', () => {
  it('prefers footer centre over header and header over body', () => {
    const score = (region: PageRegion) => extract([{ text: '17', at: region }]).candidates[0]!.score;
    expect(score('bottom-center')).toBeGreaterThan(score('top-center'));
    expect(score('bottom-right')).toBeGreaterThan(score('top-right'));
    expect(score('top-right')).toBeGreaterThan(score('body'));
    expect(score('body')).toBeLessThan(0.2);
  });

  it('prefers isolated numbers over numbers at the edge of a running header', () => {
    const { candidates } = extract([
      { text: '3 Methods', at: 'top-left' },
      { text: '17', at: 'bottom-center' },
    ]);
    expect(candidates.map((c) => c.number.value)).toEqual([17, 3]);
    expect(candidates[1]!.pattern).toBe('edge-of-text');
    expect(candidates[1]!.isolated).toBe(false);
    expect(candidates[1]!.score).toBeLessThan(candidates[0]!.score * 0.8);
  });

  it('keeps the number of a running header when it is separated by a wide gap', () => {
    const { candidates } = extract([
      { text: 'Introduction to Algorithms', at: 'top-left', split: true },
      { text: '17', at: 'top-right' },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.number.value).toBe(17);
    expect(candidates[0]!.isolated).toBe(true);
    expect(candidates[0]!.region).toBe('top-right');
  });

  it('penalises display-size digits (chapter openers)', () => {
    const big = extract([{ text: '3', at: 'top-center', h: 0.06, cw: 0.04 }]).candidates[0]!;
    const small = extract([{ text: '3', at: 'top-center' }]).candidates[0]!;
    expect(big.score).toBeLessThan(small.score * 0.5);
  });

  it('weights OCR confidence', () => {
    const hi = extract([{ text: '17', at: 'bottom-center', confidence: 0.95 }]).candidates[0]!;
    const lo = extract([{ text: '17', at: 'bottom-center', confidence: 0.4 }]).candidates[0]!;
    expect(hi.score).toBeGreaterThan(lo.score);
  });

  it('returns nothing for empty evidence and sorts candidates best first', () => {
    expect(extractCandidates({ source: 'none', bands: [], items: [], hasTextLayer: false })).toEqual({ candidates: [], rejected: [] });
    const { candidates } = extract([
      { text: '5', at: 'body' },
      { text: '17', at: 'top-right' },
      { text: '17', at: 'bottom-center' },
    ]);
    expect(candidates.map((c) => c.region)).toEqual(['bottom-center', 'top-right', 'body']);
  });
});
