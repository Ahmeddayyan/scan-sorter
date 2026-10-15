/**
 * OCR confusion knowledge: which letters are commonly produced instead of digits and
 * which digits are commonly swapped for each other at scan resolution.
 */

/** Letters/symbols OCR commonly produces in place of a digit, with the digit they stand for. */
const LETTER_TO_DIGIT: Readonly<Record<string, string>> = Object.freeze({
  O: '0',
  o: '0',
  Q: '0',
  D: '0',
  I: '1',
  l: '1',
  '|': '1',
  i: '1',
  '!': '1',
  Z: '2',
  z: '2',
  E: '3',
  A: '4',
  S: '5',
  s: '5',
  G: '6',
  b: '6',
  T: '7',
  B: '8',
  g: '9',
  q: '9',
});

/**
 * Subset used when a token is ONLY letters (no digit at all) - restricted to the shapes
 * that really look like digits in isolation, to avoid turning ordinary words into numbers.
 */
const PURE_LETTER_CONFUSABLES: ReadonlySet<string> = new Set(['O', 'o', 'l', 'I', '|', 'S', 's', 'Z', 'z', 'B', 'G']);

/** Digit -> digits it is commonly misread as. */
const DIGIT_CONFUSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '0': ['8', '6', '9'],
  '1': ['7', '4'],
  '2': ['7', '3'],
  '3': ['8', '5'],
  '4': ['1', '9'],
  '5': ['6', '3', '8'],
  '6': ['5', '8', '0'],
  '7': ['1', '2'],
  '8': ['3', '0', '6', '5'],
  '9': ['4', '0', '7'],
});

export interface ConfusableResult {
  /** Digits only. */
  digits: string;
  /** True when at least one letter was mapped to a digit. */
  changed: boolean;
}

/**
 * Map a token such as "1O", "l7", "S" to digits using the confusion table.
 * Returns `null` when the token contains characters that are neither digits nor
 * confusable letters, or when it is letters-only and not a plausible digit shape.
 */
export function confusableToDigits(raw: string): ConfusableResult | null {
  if (raw.length === 0 || raw.length > 4) return null;
  let digits = '';
  let changed = false;
  let hasDigit = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      hasDigit = true;
      continue;
    }
    const mapped = LETTER_TO_DIGIT[ch];
    if (mapped === undefined) return null;
    digits += mapped;
    changed = true;
  }
  if (!hasDigit) {
    // Letters only: only accept the small set of shapes that really look like digits,
    // and at most two characters ("lO" -> 10) to keep the false-positive rate down.
    if (raw.length > 2) return null;
    for (const ch of raw) if (!PURE_LETTER_CONFUSABLES.has(ch)) return null;
  }
  return { digits, changed };
}

/**
 * All digit strings reachable from `digits` by swapping ONE character for a commonly
 * confused digit. Order is deterministic; the input itself is excluded, as are results
 * with a leading zero.
 */
export function digitVariants(digits: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([digits]);
  for (let i = 0; i < digits.length; i += 1) {
    const alternatives = DIGIT_CONFUSIONS[digits[i]!] ?? [];
    for (const alt of alternatives) {
      const v = digits.slice(0, i) + alt + digits.slice(i + 1);
      if (v[0] === '0' && v.length > 1) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
