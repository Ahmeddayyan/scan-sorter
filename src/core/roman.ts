/** Strict (canonical) roman numeral grammar, 1..3999. */
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

const VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/**
 * Parse a canonical roman numeral (either case). Returns `null` for anything that is
 * not a well-formed numeral, so words like "mix", "dim", "civil" or "ill" are rejected.
 */
export function parseRoman(text: string): number | null {
  const s = text.toUpperCase();
  if (s.length === 0 || !ROMAN_RE.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i += 1) {
    const v = VALUES[s[i]!]!;
    const next = i + 1 < s.length ? VALUES[s[i + 1]!]! : 0;
    total += v < next ? -v : v;
  }
  return total;
}

const TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

/** Format 1..3999 as a lowercase roman numeral (uppercase on request). */
export function toRoman(value: number, upper = false): string {
  if (!Number.isInteger(value) || value <= 0 || value > 3999) {
    throw new RangeError(`toRoman: value out of range: ${value}`);
  }
  let n = value;
  let out = '';
  for (const [v, s] of TABLE) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return upper ? out.toUpperCase() : out;
}

/** True when the text consists only of roman numeral letters (does not check grammar). */
export function looksRoman(text: string): boolean {
  return /^[ivxlcdm]+$/i.test(text);
}
