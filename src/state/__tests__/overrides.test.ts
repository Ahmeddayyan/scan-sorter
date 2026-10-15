import { describe, expect, it } from 'vitest';
import { EMPTY_OVERRIDES } from '../../core';
import { applyOverrideEdit, hasUserEdits, moveInOrder, rotateBy } from '../overrides';

describe('applyOverrideEdit', () => {
  it('sets, replaces and clears a manual number without mutating', () => {
    const a = applyOverrideEdit(EMPTY_OVERRIDES, { type: 'number/set', pageId: 'p1', number: { value: 4, style: 'arabic' } });
    expect(a.numbers).toEqual({ p1: { value: 4, style: 'arabic' } });
    expect(EMPTY_OVERRIDES.numbers).toEqual({});
    const same = applyOverrideEdit(a, { type: 'number/set', pageId: 'p1', number: { value: 4, style: 'arabic' } });
    expect(same).toBe(a);
    const none = applyOverrideEdit(a, { type: 'number/set', pageId: 'p1', number: null });
    expect(none.numbers.p1).toBeNull();
    const cleared = applyOverrideEdit(none, { type: 'number/clear', pageId: 'p1' });
    expect(cleared.numbers).toEqual({});
    expect(applyOverrideEdit(cleared, { type: 'number/clear', pageId: 'p1' })).toBe(cleared);
  });

  it('removes and restores pages, ignoring duplicates', () => {
    const a = applyOverrideEdit(EMPTY_OVERRIDES, { type: 'pages/remove', pageIds: ['a', 'b', 'a'] });
    expect(a.removed).toEqual(['a', 'b']);
    expect(applyOverrideEdit(a, { type: 'pages/remove', pageIds: ['a'] })).toBe(a);
    const b = applyOverrideEdit(a, { type: 'pages/restore', pageIds: ['a'] });
    expect(b.removed).toEqual(['b']);
    expect(applyOverrideEdit(b, { type: 'pages/restore', pageIds: ['zzz'] })).toBe(b);
  });

  it('rotates in quarter turns and drops the key at 0', () => {
    let o = EMPTY_OVERRIDES;
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      o = applyOverrideEdit(o, { type: 'page/rotate', pageId: 'p', quarterTurns: 1 });
      seen.push(o.rotations.p ?? 0);
    }
    expect(seen).toEqual([90, 180, 270, 0]);
    expect(Object.keys(o.rotations)).toEqual([]);
    expect(rotateBy(0, -1)).toBe(270);
    expect(rotateBy(undefined, 0)).toBe(0);
  });

  it('sets and restores manual order', () => {
    const a = applyOverrideEdit(EMPTY_OVERRIDES, { type: 'order/manual', order: ['x', 'y'] });
    expect(a.manualOrder).toEqual(['x', 'y']);
    expect(applyOverrideEdit(a, { type: 'order/manual', order: ['x', 'y'] })).toBe(a);
    const b = applyOverrideEdit(a, { type: 'order/auto' });
    expect(b.manualOrder).toBeNull();
    expect(applyOverrideEdit(b, { type: 'order/auto' })).toBe(b);
  });

  it('knows whether anything was edited', () => {
    expect(hasUserEdits(EMPTY_OVERRIDES)).toBe(false);
    expect(hasUserEdits(applyOverrideEdit(EMPTY_OVERRIDES, { type: 'order/manual', order: [] }))).toBe(true);
  });
});

describe('moveInOrder', () => {
  it('moves forwards and backwards', () => {
    expect(moveInOrder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveInOrder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveInOrder(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
