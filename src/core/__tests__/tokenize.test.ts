import { describe, expect, it } from 'vitest';
import { buildLines, tokenize } from '../tokenize';
import { placeText } from './helpers';

describe('tokenize / buildLines', () => {
  it('splits text runs into words with proportional boxes', () => {
    const tokens = tokenize([{ text: 'Page 12 of 40', box: { x: 0.4, y: 0.95, w: 0.13, h: 0.012 }, confidence: 1 }]);
    expect(tokens.map((t) => t.text)).toEqual(['Page', '12', 'of', '40']);
    expect(tokens[0]!.box.x).toBeCloseTo(0.4);
    expect(tokens[3]!.box.x + tokens[3]!.box.w).toBeCloseTo(0.53);
    expect(tokens[1]!.box.x).toBeGreaterThan(tokens[0]!.box.x + tokens[0]!.box.w);
  });

  it('ignores empty items', () => {
    expect(tokenize([{ text: '   ', box: { x: 0, y: 0, w: 0.1, h: 0.01 }, confidence: 1 }])).toEqual([]);
  });

  it('groups by line and splits segments at wide gaps', () => {
    const items = [
      ...placeText({ text: 'Introduction to Algorithms', at: 'top-left', split: true }),
      ...placeText({ text: '17', at: 'top-right' }),
      ...placeText({ text: '18', at: 'bottom-center' }),
    ];
    const lines = buildLines(tokenize(items));
    expect(lines).toHaveLength(2);
    const header = lines[0]!;
    expect(header.tokens.map((t) => t.text)).toEqual(['Introduction', 'to', 'Algorithms', '17']);
    expect(header.segments.map((s) => s.text)).toEqual(['Introduction to Algorithms', '17']);
    expect(lines[1]!.segments[0]!.text).toBe('18');
  });

  it('keeps a superscript marker on the same line as its text', () => {
    const items = [
      ...placeText({ text: 'see note', at: { x: 0.3, y: 0.5 }, split: true }),
      { text: '1', box: { x: 0.36, y: 0.492, w: 0.004, h: 0.006 }, confidence: 1 },
    ];
    const lines = buildLines(tokenize(items));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.tokens.map((t) => t.text)).toEqual(['see', 'note', '1']);
  });
});
