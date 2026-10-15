import { describe, expect, it } from 'vitest';
import { looksRoman, parseRoman, toRoman } from '../roman';

describe('roman numerals', () => {
  it('parses canonical numerals in either case', () => {
    expect(parseRoman('i')).toBe(1);
    expect(parseRoman('iv')).toBe(4);
    expect(parseRoman('IX')).toBe(9);
    expect(parseRoman('xii')).toBe(12);
    expect(parseRoman('XLII')).toBe(42);
    expect(parseRoman('mcmxciv')).toBe(1994);
  });

  it('rejects words that merely use roman letters', () => {
    for (const w of ['did', 'civil', 'ill', 'dim', 'mid', 'lid', 'vim', 'mild', 'iiii', 'vv', 'ic', '']) {
      expect(parseRoman(w), w).toBeNull();
    }
    expect(parseRoman('mix')).toBe(1009); // grammatical but huge; capped by MAX_ROMAN downstream
  });

  it('formats and round-trips', () => {
    expect(toRoman(4)).toBe('iv');
    expect(toRoman(1994, true)).toBe('MCMXCIV');
    for (let n = 1; n <= 3999; n += 1) expect(parseRoman(toRoman(n))).toBe(n);
    expect(() => toRoman(0)).toThrow(RangeError);
  });

  it('looksRoman only checks the alphabet', () => {
    expect(looksRoman('xiv')).toBe(true);
    expect(looksRoman('mix')).toBe(true);
    expect(looksRoman('x1')).toBe(false);
  });
});
