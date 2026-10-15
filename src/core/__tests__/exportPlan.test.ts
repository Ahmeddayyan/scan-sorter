import { describe, expect, it } from 'vitest';
import { EMPTY_OVERRIDES } from '../constants';
import { buildExportPlan, suggestExportFileName } from '../exportPlan';
import { inferDocument } from '../inference';
import type { SourceFile } from '../types';
import { footerPages } from './helpers';

const source = (name: string, inputIndex = 0): SourceFile => ({
  id: `f${inputIndex}`,
  name,
  kind: 'pdf',
  mimeType: 'application/pdf',
  size: 1,
  inputIndex,
  pageCount: 3,
});

describe('export plan', () => {
  it('suggests <original>-sorted.pdf', () => {
    expect(suggestExportFileName([source('lecture notes.pdf')])).toBe('lecture notes-sorted.pdf');
    expect(suggestExportFileName([source('b.jpg', 1), source('a.pdf', 0)])).toBe('a-sorted.pdf');
    expect(suggestExportFileName([source('weird:name?.png')])).toBe('weird-name--sorted.pdf');
    expect(suggestExportFileName([])).toBe('scans-sorted.pdf');
  });

  it('orders pages, applies rotations and skips removed pages', () => {
    const pages = footerPages(['3', '1', '2']);
    const overrides = { ...EMPTY_OVERRIDES, rotations: { p0: 90 as const }, removed: ['p2'] };
    const result = inferDocument(pages, { overrides });
    const plan = buildExportPlan(pages, result, overrides, [source('doc.pdf')]);
    expect(plan.fileName).toBe('doc-sorted.pdf');
    expect(plan.pages.map((p) => [p.pageId, p.rotation, p.number?.value])).toEqual([
      ['p1', 0, 1],
      ['p0', 90, 3],
    ]);
    expect(plan.pages[0]).toMatchObject({ sourceFileId: 'f0', sourceIndex: 1, kind: 'pdf-page' });
  });
});
