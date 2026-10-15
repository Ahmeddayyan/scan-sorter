import { describe, expect, it } from 'vitest';
import { comparePageNumbers, formatPageNumber, pageNumberKey, parsePageNumberInput, samePageNumber } from '../pageNumber';

describe('page number helpers', () => {
  it('parses user input', () => {
    expect(parsePageNumberInput('17')).toEqual({ value: 17, style: 'arabic' });
    expect(parsePageNumberInput('  17 ')).toEqual({ value: 17, style: 'arabic' });
    expect(parsePageNumberInput('iv')).toEqual({ value: 4, style: 'roman' });
    expect(parsePageNumberInput('IV')).toEqual({ value: 4, style: 'roman' });
    for (const bad of ['', '0', '-1', '2.5', 'abc', 'mix']) expect(parsePageNumberInput(bad), bad).toBeNull();
    expect(parsePageNumberInput('mix')).toBeNull();
  });

  it('formats, compares and keys', () => {
    expect(formatPageNumber({ value: 12, style: 'arabic' })).toBe('12');
    expect(formatPageNumber({ value: 12, style: 'roman' })).toBe('xii');
    expect(comparePageNumbers({ value: 99, style: 'roman' }, { value: 1, style: 'arabic' })).toBeLessThan(0);
    expect(comparePageNumbers({ value: 3, style: 'arabic' }, { value: 2, style: 'arabic' })).toBeGreaterThan(0);
    expect(samePageNumber({ value: 3, style: 'arabic' }, { value: 3, style: 'roman' })).toBe(false);
    expect(samePageNumber(null, null)).toBe(true);
    expect(pageNumberKey({ value: 3, style: 'roman' })).toBe('roman:3');
  });
});
