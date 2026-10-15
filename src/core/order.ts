import { comparePageNumbers, pageNumberKey } from './pageNumber';
import type { GridSlot, NumberingStyle, PageId, PageNumber, PageRecord } from './types';

/**
 * Compute the display order.
 *
 * - `manualOrder` (user drag-reordered): that order, filtered to active pages, with any
 *   page not mentioned appended in input order.
 * - Otherwise: numbered pages sorted roman-first then by value (ties by input index), and
 *   every unnumbered page kept directly after the page that preceded it in the input
 *   (chains of unnumbered pages stay together; leading unnumbered pages go first).
 *
 * @param pages   active (non-removed) pages, sorted by inputIndex
 * @param numbers effective number per page id (`null` = unnumbered)
 */
export function buildOrder(
  pages: readonly PageRecord[],
  numbers: ReadonlyMap<PageId, PageNumber | null>,
  manualOrder: readonly PageId[] | null,
): PageId[] {
  const active = new Set(pages.map((p) => p.id));
  if (manualOrder) {
    const seen = new Set<PageId>();
    const out: PageId[] = [];
    for (const id of manualOrder) {
      if (active.has(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    for (const p of pages) if (!seen.has(p.id)) out.push(p.id);
    return out;
  }

  const numbered: PageRecord[] = [];
  const leading: PageId[] = [];
  const attached = new Map<PageId, PageId[]>();
  let anchor: PageId | null = null;
  for (const p of pages) {
    const n = numbers.get(p.id) ?? null;
    if (n) {
      numbered.push(p);
      anchor = p.id;
    } else if (anchor === null) {
      leading.push(p.id);
    } else {
      const list = attached.get(anchor);
      if (list) list.push(p.id);
      else attached.set(anchor, [p.id]);
    }
  }
  numbered.sort((a, b) => comparePageNumbers(numbers.get(a.id)!, numbers.get(b.id)!) || a.inputIndex - b.inputIndex);

  const out: PageId[] = [...leading];
  for (const p of numbered) {
    out.push(p.id);
    const tail = attached.get(p.id);
    if (tail) out.push(...tail);
  }
  return out;
}

/**
 * Turn the order into grid tiles, inserting "missing page" placeholders where the
 * numbering jumps. Leading placeholders ([1..first-1]) are only inserted when a document
 * total is known (otherwise the document is probably an excerpt - soft note instead);
 * trailing placeholders ([last+1..total]) when the total exceeds the last number.
 */
export function buildSlots(
  order: readonly PageId[],
  numbers: ReadonlyMap<PageId, PageNumber | null>,
  detectedTotal: number | null,
  manual: boolean,
): GridSlot[] {
  const slots: GridSlot[] = [];
  if (manual) {
    for (const id of order) slots.push({ kind: 'page', id: `page:${id}`, pageId: id });
    return slots;
  }
  const last: Record<NumberingStyle, number | null> = { roman: null, arabic: null };
  const pushGap = (style: NumberingStyle, from: number, to: number): void => {
    if (to < from) return;
    slots.push({
      kind: 'gap',
      id: `gap:${pageNumberKey({ style, value: from })}-${to}`,
      from: { style, value: from },
      to: { style, value: to },
      count: to - from + 1,
    });
  };
  for (const id of order) {
    const n = numbers.get(id) ?? null;
    if (n) {
      const prev = last[n.style];
      if (prev === null && n.style === 'arabic' && detectedTotal !== null && n.value > 1) {
        pushGap('arabic', 1, n.value - 1);
      }
      if (prev !== null && n.value > prev + 1) pushGap(n.style, prev + 1, n.value - 1);
      last[n.style] = prev === null ? n.value : Math.max(prev, n.value);
    }
    slots.push({ kind: 'page', id: `page:${id}`, pageId: id });
  }
  if (detectedTotal !== null && last.arabic !== null && last.arabic < detectedTotal) {
    pushGap('arabic', last.arabic + 1, detectedTotal);
  }
  return slots;
}
