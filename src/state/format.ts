/** Small text helpers shared by components (pure). */
import type { GridSlot, MissingRange, PageNumber } from '../core';
import { formatPageNumber } from '../core';

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Page 17" / "Pages 20–35" / "Page iv" */
export function formatRange(range: Pick<MissingRange, 'style' | 'from' | 'to'>): string {
  const a = formatPageNumber({ style: range.style, value: range.from });
  if (range.from === range.to) return `Page ${a}`;
  return `Pages ${a}–${formatPageNumber({ style: range.style, value: range.to })}`;
}

export type GapSlot = Extract<GridSlot, { kind: 'gap' }>;

export function gapRange(slot: GapSlot): Pick<MissingRange, 'style' | 'from' | 'to'> {
  return { style: slot.from.style, from: slot.from.value, to: slot.to.value };
}

export function gapLabel(slot: GapSlot): string {
  return `${formatRange(gapRange(slot))} missing`;
}

/** Badge text: "p. 12", "p. iv" or "?" */
export function badgeText(n: PageNumber | null): string {
  return n === null ? '?' : `p. ${formatPageNumber(n)}`;
}

/** Turn a thrown value into something a non-technical person can read. */
export function friendlyError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/not implemented/i.test(message)) return 'This part of the app is not available yet.';
  if (/password|encrypt/i.test(message)) return 'This file is password protected.';
  if (/out of memory|allocation/i.test(message)) return 'The device ran out of memory. Try fewer pages at a time.';
  return message.trim().length > 0 ? `${fallback} (${message.trim()})` : fallback;
}
