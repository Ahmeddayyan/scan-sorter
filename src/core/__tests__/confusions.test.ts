import { describe, expect, it } from 'vitest';
import { confusableToDigits, digitVariants } from '../confusions';

describe('OCR confusions', () => {
  it('maps confusable letters to digits', () => {
    expect(confusableToDigits('1O')).toEqual({ digits: '10', changed: true });
    expect(confusableToDigits('l7')).toEqual({ digits: '17', changed: true });
    expect(confusableToDigits('S')).toEqual({ digits: '5', changed: true });
    expect(confusableToDigits('12')).toEqual({ digits: '12', changed: false });
    expect(confusableToDigits('do')).toBeNull(); // 'd' is not a digit shape
    expect(confusableToDigits('SSS')).toBeNull(); // letters-only limited to 2 chars
    expect(confusableToDigits('12345')).toBeNull();
    expect(confusableToDigits('1x')).toBeNull();
  });

  it('generates single-substitution digit variants without leading zeros', () => {
    expect(digitVariants('77')).toEqual(['17', '27', '71', '72']);
    expect(digitVariants('1')).toEqual(['7', '4']);
    expect(digitVariants('10')).not.toContain('00');
    expect(digitVariants('10')).toContain('70');
    expect(digitVariants('5')).toEqual(['6', '3', '8']);
  });
});
