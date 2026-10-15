/**
 * Pure edit functions for UserOverrides. Every function returns the SAME object when the
 * edit changes nothing, so callers can cheaply skip history entries for no-ops.
 */
import type { PageId, PageNumber, Rotation, UserOverrides } from '../core';
import { samePageNumber } from '../core';

export type OverrideEdit =
  | { type: 'number/set'; pageId: PageId; number: PageNumber | null }
  | { type: 'number/clear'; pageId: PageId }
  | { type: 'pages/remove'; pageIds: readonly PageId[] }
  | { type: 'pages/restore'; pageIds: readonly PageId[] }
  | { type: 'page/rotate'; pageId: PageId; quarterTurns: number }
  | { type: 'order/manual'; order: readonly PageId[] }
  | { type: 'order/auto' };

export function rotateBy(current: Rotation | undefined, quarterTurns: number): Rotation {
  const turns = ((Math.round(quarterTurns) % 4) + 4) % 4;
  const base = (current ?? 0) / 90;
  return (((base + turns) % 4) * 90) as Rotation;
}

function has(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy: Record<string, T> = { ...record };
  delete copy[key];
  return copy;
}

export function applyOverrideEdit(o: UserOverrides, edit: OverrideEdit): UserOverrides {
  switch (edit.type) {
    case 'number/set': {
      if (has(o.numbers, edit.pageId) && samePageNumber(o.numbers[edit.pageId] ?? null, edit.number)) return o;
      return { ...o, numbers: { ...o.numbers, [edit.pageId]: edit.number } };
    }
    case 'number/clear': {
      if (!has(o.numbers, edit.pageId)) return o;
      return { ...o, numbers: omit(o.numbers, edit.pageId) };
    }
    case 'pages/remove': {
      const fresh = [...new Set(edit.pageIds)].filter((id) => !o.removed.includes(id));
      if (fresh.length === 0) return o;
      return { ...o, removed: [...o.removed, ...fresh] };
    }
    case 'pages/restore': {
      const drop = new Set(edit.pageIds);
      if (!o.removed.some((id) => drop.has(id))) return o;
      return { ...o, removed: o.removed.filter((id) => !drop.has(id)) };
    }
    case 'page/rotate': {
      const next = rotateBy(o.rotations[edit.pageId], edit.quarterTurns);
      if (next === (o.rotations[edit.pageId] ?? 0)) return o;
      return {
        ...o,
        rotations: next === 0 ? omit(o.rotations, edit.pageId) : { ...o.rotations, [edit.pageId]: next },
      };
    }
    case 'order/manual': {
      const prev = o.manualOrder;
      if (prev && prev.length === edit.order.length && prev.every((id, i) => id === edit.order[i])) return o;
      return { ...o, manualOrder: [...edit.order] };
    }
    case 'order/auto':
      return o.manualOrder === null ? o : { ...o, manualOrder: null };
  }
}

/** True when the user has changed anything (used to confirm "Start over"). */
export function hasUserEdits(o: UserOverrides): boolean {
  return (
    Object.keys(o.numbers).length > 0 ||
    o.removed.length > 0 ||
    Object.keys(o.rotations).length > 0 ||
    o.manualOrder !== null
  );
}

/** Move one id inside an order array (drag-and-drop result). */
export function moveInOrder(order: readonly PageId[], from: number, to: number): PageId[] {
  const next = [...order];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
