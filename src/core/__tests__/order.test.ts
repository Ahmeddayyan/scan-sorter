import { describe, expect, it } from 'vitest';
import { buildOrder, buildSlots } from '../order';
import type { PageNumber } from '../types';
import { makePages } from './helpers';

const n = (value: number, style: PageNumber['style'] = 'arabic'): PageNumber => ({ value, style });

describe('buildOrder', () => {
  it('sorts numbered pages and keeps unnumbered pages after their input predecessor', () => {
    const pages = makePages([{ id: 'a' }, { id: 'u1' }, { id: 'b' }, { id: 'c' }, { id: 'u2' }, { id: 'u3' }, { id: 'd' }]);
    const numbers = new Map([
      ['a', n(3)],
      ['u1', null],
      ['b', n(1)],
      ['c', n(2)],
      ['u2', null],
      ['u3', null],
      ['d', n(5)],
    ]);
    expect(buildOrder(pages, numbers, null)).toEqual(['b', 'c', 'u2', 'u3', 'a', 'u1', 'd']);
  });

  it('puts leading unnumbered pages first and roman before arabic', () => {
    const pages = makePages([{ id: 'u0' }, { id: 'a' }, { id: 'b' }, { id: 'r' }]);
    const numbers = new Map([
      ['u0', null],
      ['a', n(2)],
      ['b', n(1)],
      ['r', n(3, 'roman')],
    ]);
    expect(buildOrder(pages, numbers, null)).toEqual(['u0', 'r', 'b', 'a']);
  });

  it('applies a manual order and appends unknown pages', () => {
    const pages = makePages([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const numbers = new Map([
      ['a', n(1)],
      ['b', n(2)],
      ['c', n(3)],
    ]);
    expect(buildOrder(pages, numbers, ['c', 'zzz', 'a', 'c'])).toEqual(['c', 'a', 'b']);
  });
});

describe('buildSlots', () => {
  it('inserts gap tiles between non-consecutive numbers', () => {
    const numbers = new Map([
      ['a', n(1)],
      ['b', n(2)],
      ['u', null],
      ['c', n(5)],
    ]);
    const slots = buildSlots(['a', 'b', 'u', 'c'], numbers, null, false);
    expect(slots.map((s) => (s.kind === 'page' ? s.pageId : `gap ${s.from.value}-${s.to.value}`))).toEqual(['a', 'b', 'u', 'gap 3-4', 'c']);
    expect(slots[3]).toMatchObject({ kind: 'gap', count: 2, id: 'gap:arabic:3-4' });
  });

  it('adds leading/trailing gaps only with a known total', () => {
    const numbers = new Map([
      ['a', n(3)],
      ['b', n(4)],
    ]);
    expect(buildSlots(['a', 'b'], numbers, null, false).map((s) => s.kind)).toEqual(['page', 'page']);
    const withTotal = buildSlots(['a', 'b'], numbers, 6, false);
    expect(withTotal.map((s) => (s.kind === 'gap' ? `gap ${s.from.value}-${s.to.value}` : s.pageId))).toEqual(['gap 1-2', 'a', 'b', 'gap 5-6']);
  });

  it('never inserts gaps in manual order mode', () => {
    const numbers = new Map([
      ['a', n(1)],
      ['b', n(9)],
    ]);
    expect(buildSlots(['b', 'a'], numbers, 12, true).map((s) => s.kind)).toEqual(['page', 'page']);
  });
});
