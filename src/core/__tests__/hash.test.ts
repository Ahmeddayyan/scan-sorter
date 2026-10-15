import { describe, expect, it } from 'vitest';
import { dHashFromGray, hammingDistance, isNearDuplicate } from '../hash';

describe('perceptual hash helpers', () => {
  it('computes hamming distance between hex hashes', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(hammingDistance('0000000000000001', '0000000000000000')).toBe(1);
    expect(hammingDistance('f0f0', '0f0f')).toBe(16);
    expect(hammingDistance('0xABCD', 'abcd')).toBe(0);
  });

  it('left-pads hashes of different length', () => {
    expect(hammingDistance('1', '0000000000000001')).toBe(0);
  });

  it('throws on non-hex input', () => {
    expect(() => hammingDistance('zz', '00')).toThrow(TypeError);
  });

  it('isNearDuplicate returns null for missing hashes', () => {
    expect(isNearDuplicate(null, 'abcd')).toBeNull();
    expect(isNearDuplicate('abcd', undefined)).toBeNull();
    expect(isNearDuplicate('0000000000000000', '0000000000000007')).toBe(true);
    expect(isNearDuplicate('0000000000000000', '00000000000007ff')).toBe(false);
    expect(isNearDuplicate('0000000000000000', '00000000000007ff', 11)).toBe(true);
  });

  it('dHashFromGray produces 16 hex chars from a 9x8 sample', () => {
    const descending = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 10);
    expect(dHashFromGray(descending)).toBe('ffffffffffffffff');
    const ascending = Array.from({ length: 72 }, (_, i) => (i % 9) * 10);
    expect(dHashFromGray(ascending)).toBe('0000000000000000');
    expect(() => dHashFromGray([1, 2, 3])).toThrow(RangeError);
  });
});
