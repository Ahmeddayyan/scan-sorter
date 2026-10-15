import { MAX_ROMAN } from './constants';
import { parseRoman, toRoman } from './roman';
import type { NumberingStyle, PageNumber } from './types';

const STYLE_RANK: Record<NumberingStyle, number> = { roman: 0, arabic: 1 };

export function pageNumber(value: number, style: NumberingStyle = 'arabic'): PageNumber {
  return { value, style };
}

/** "17" or "iv". */
export function formatPageNumber(n: PageNumber): string {
  return n.style === 'roman' ? toRoman(n.value) : String(n.value);
}

/**
 * Parse what a user typed into the badge editor: "17", " 17 ", "iv", "IV".
 * Returns `null` for anything else (empty, 0, negative, decimals, words, roman numerals
 * above MAX_ROMAN such as "mix").
 */
export function parsePageNumberInput(text: string): PageNumber | null {
  const s = text.trim();
  if (/^\d{1,6}$/.test(s)) {
    const value = Number.parseInt(s, 10);
    return value > 0 ? { value, style: 'arabic' } : null;
  }
  const roman = parseRoman(s);
  return roman !== null && roman > 0 && roman <= MAX_ROMAN ? { value: roman, style: 'roman' } : null;
}

/** Roman before arabic, then by value. */
export function comparePageNumbers(a: PageNumber, b: PageNumber): number {
  return STYLE_RANK[a.style] - STYLE_RANK[b.style] || a.value - b.value;
}

export function samePageNumber(a: PageNumber | null, b: PageNumber | null): boolean {
  if (a === null || b === null) return a === b;
  return a.style === b.style && a.value === b.value;
}

/** Stable string key, e.g. "arabic:17" - handy for Record/Map keys and React keys. */
export function pageNumberKey(n: PageNumber): string {
  return `${n.style}:${n.value}`;
}
