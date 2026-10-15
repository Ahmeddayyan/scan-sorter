import { describe, expect, it } from 'vitest';
import { inferDocument } from '../../core';
import type { PageAssignment, PageRecord } from '../../core';
import { buildDemoSession } from '../demo';
import { allSafeToRemove, badgeInfo, describeProgress, exportWarnings, headline, issueByPage } from '../derive';
import { classifyFile, classifyFiles, rejectionMessage } from '../files';
import { formatRange, friendlyError, gapLabel } from '../format';
import { nextTheme, parseTheme } from '../theme';

const demo = buildDemoSession();
const result = inferDocument(demo.pages);

describe('headline and export warnings', () => {
  it('summarises problems for the demo', () => {
    const h = headline(result.report, false);
    expect(h.tone).toBe('attention');
    expect(h.text).toContain('1 page missing');
    expect(h.text).toContain('duplicate');
  });

  it('handles empty and in-progress states', () => {
    expect(headline(inferDocument([]).report, false).text).toBe('No pages to show');
    expect(headline(result.report, true).tone).toBe('neutral');
  });

  it('says all pages are in order when nothing is wrong', () => {
    const fine = {
      ...result.report,
      missing: [],
      duplicates: [],
      unnumbered: [],
      lowConfidence: [],
      summary: { ...result.report.summary, missing: 0, unnumbered: 0, lowConfidence: 0, duplicates: 0 },
    };
    const h = headline(fine, false);
    expect(h.tone).toBe('ok');
    expect(h.text).toBe('All 32 pages in order');
  });

  it('warns about missing pages and conflicts only', () => {
    const w = exportWarnings(result.report);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/missing/);
    expect(exportWarnings({ ...result.report, duplicates: [], summary: { ...result.report.summary, missing: 0 } })).toEqual([]);
  });

  it('collects safe-to-remove duplicates and maps issues by page', () => {
    expect(allSafeToRemove(result.report)).toHaveLength(1);
    const map = issueByPage(result.report);
    expect([...map.values()].sort()).toEqual(['conflict', 'conflict', 'duplicate-scan', 'duplicate-scan']);
  });
});

describe('badgeInfo', () => {
  const page = (status: PageRecord['status']): PageRecord => ({ ...demo.pages[0]!, status });

  it('shows pending and error states', () => {
    expect(badgeInfo(page('pending'), undefined, null).tone).toBe('pending');
    expect(badgeInfo({ ...page('error'), error: 'boom' }, undefined, null).description).toContain('boom');
  });

  it('colours by assignment', () => {
    const base: PageAssignment = {
      pageId: 'x',
      number: { value: 3, style: 'arabic' },
      total: null,
      confidence: 0.9,
      source: 'text-layer',
      reason: 'r',
      flags: [],
      candidate: null,
      suggestions: [],
    };
    const p = page('done');
    expect(badgeInfo(p, base, null)).toMatchObject({ tone: 'ok', text: 'p. 3' });
    expect(badgeInfo(p, { ...base, flags: ['low-confidence'] }, null).tone).toBe('warn');
    expect(badgeInfo(p, base, 'conflict').tone).toBe('danger');
    expect(badgeInfo(p, base, 'duplicate-scan').tone).toBe('warn');
    expect(badgeInfo(p, { ...base, source: 'manual', flags: ['manual'] }, null).tone).toBe('manual');
    expect(badgeInfo(p, { ...base, number: null, flags: ['unnumbered'] }, null)).toMatchObject({
      tone: 'neutral',
      text: '?',
    });
    expect(badgeInfo(p, { ...base, number: { value: 4, style: 'roman' } }, null).text).toBe('p. iv');
  });

  it('covers every demo page without throwing', () => {
    const issues = issueByPage(result.report);
    for (const p of demo.pages) {
      expect(badgeInfo(p, result.assignments[p.id], issues.get(p.id) ?? null).text.length).toBeGreaterThan(0);
    }
  });
});

describe('describeProgress', () => {
  it('is indeterminate until the total is known', () => {
    const v = describeProgress({
      phase: 'loading',
      totalPages: null,
      renderedPages: 0,
      analyzedPages: 0,
      ocrPages: 0,
      currentFile: 'a.pdf',
      message: null,
    });
    expect(v.fraction).toBeNull();
    expect(v.detail).toBe('a.pdf');
  });

  it('reports fraction, counts, OCR and queue', () => {
    const v = describeProgress(
      {
        phase: 'analyzing',
        totalPages: 40,
        renderedPages: 40,
        analyzedPages: 10,
        ocrPages: 3,
        currentFile: 'a.pdf',
        message: null,
      },
      2,
    );
    expect(v.fraction).toBe(0.25);
    expect(v.counts).toBe('10 of 40 pages read');
    expect(v.detail).toContain('3 scanned pages read by OCR');
    expect(v.detail).toContain('2 more files waiting');
  });
});

describe('files', () => {
  it('classifies by mime type and extension', () => {
    expect(classifyFile({ name: 'a.PDF', type: '' })).toBe('pdf');
    expect(classifyFile({ name: 'x', type: 'image/webp' })).toBe('image');
    expect(classifyFile({ name: 'x.jpeg', type: '' })).toBe('image');
    expect(classifyFile({ name: 'IMG.HEIC', type: 'image/heic' })).toBe('heic');
    expect(classifyFile({ name: 'a.docx', type: 'application/msword' })).toBe('unsupported');
    expect(classifyFile({ name: 'a.gif', type: 'image/gif' })).toBe('unsupported');
  });

  it('splits accepted and rejected with friendly messages', () => {
    const { accepted, rejected } = classifyFiles([
      { name: 'a.pdf', type: 'application/pdf' },
      { name: 'b.txt', type: 'text/plain' },
      { name: 'c.heic', type: '' },
    ]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejectionMessage([rejected[0]!])).toContain('b.txt');
    expect(rejectionMessage(rejected)).toContain('2 files were skipped');
    expect(rejectionMessage([])).toBe('');
  });
});

describe('format and theme helpers', () => {
  it('formats ranges and gaps', () => {
    expect(formatRange({ style: 'arabic', from: 17, to: 17 })).toBe('Page 17');
    expect(formatRange({ style: 'arabic', from: 20, to: 35 })).toBe('Pages 20–35');
    expect(formatRange({ style: 'roman', from: 2, to: 4 })).toBe('Pages ii–iv');
    const gap = result.slots.find((s) => s.kind === 'gap');
    expect(gap && gap.kind === 'gap' ? gapLabel(gap) : '').toBe('Page 14 missing');
  });

  it('makes errors friendly', () => {
    expect(friendlyError(new Error('processFiles is not implemented yet'), 'x')).toMatch(/not available/);
    expect(friendlyError(new Error('weird'), 'Could not read.')).toBe('Could not read. (weird)');
    expect(friendlyError(undefined, 'Could not read.')).toBe('Could not read.');
  });

  it('cycles and parses themes', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('purple')).toBe('system');
    expect(parseTheme(null)).toBe('system');
  });
});
