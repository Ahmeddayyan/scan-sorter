import { describe, expect, it } from 'vitest';
import { formatPageNumber, inferDocument } from '../../core';
import { buildDemoSession, isDemoRequested, pageSvgDataUrl } from '../demo';

describe('demo session', () => {
  const session = buildDemoSession();
  const result = inferDocument(session.pages);

  it('is deterministic and about 30 pages', () => {
    expect(buildDemoSession().pages.map((p) => p.id)).toEqual(session.pages.map((p) => p.id));
    expect(session.pages.length).toBeGreaterThanOrEqual(28);
    expect(session.pages.length).toBeLessThanOrEqual(36);
    expect(new Set(session.pages.map((p) => p.id)).size).toBe(session.pages.length);
    expect(session.pages.map((p) => p.inputIndex)).toEqual(session.pages.map((_, i) => i));
    expect(session.sources.reduce((n, s) => n + (s.pageCount ?? 0), 0)).toBe(session.pages.length);
  });

  it('every page has a thumbnail and candidates computed by the real extractor', () => {
    for (const p of session.pages) {
      expect(p.thumbnail?.url.startsWith('data:image/svg+xml,')).toBe(true);
      expect(p.status).toBe('done');
    }
    expect(session.pages.filter((p) => p.candidates.length > 0).length).toBeGreaterThan(25);
  });

  it('is shuffled', () => {
    const inInputOrder = result.order.every((id, i) => id === session.pages[i]!.id);
    expect(inInputOrder).toBe(false);
  });

  it('exercises every kind of warning', () => {
    const r = result.report;
    expect(r.missing.some((m) => m.style === 'arabic' && m.from === 14 && m.to === 14)).toBe(true);
    expect(r.duplicates.some((d) => d.kind === 'duplicate-scan' && d.safeToRemove.length === 1)).toBe(true);
    expect(r.duplicates.some((d) => d.kind === 'conflict')).toBe(true);
    expect(r.unnumbered.length).toBeGreaterThanOrEqual(2);
    expect(r.lowConfidence.length).toBeGreaterThanOrEqual(1);
    expect(r.notes.some((n) => n.kind === 'front-matter')).toBe(true);
  });

  it('sorts roman front matter first', () => {
    const numbers = result.order
      .map((id) => result.assignments[id]!.number)
      .filter((n) => n !== null)
      .slice(0, 3)
      .map((n) => formatPageNumber(n!));
    expect(numbers).toEqual(['i', 'ii', 'iii']);
  });

  it('builds escaped SVG thumbnails', () => {
    const url = pageSvgDataUrl({ footer: '<7>', seed: 1, figure: true, blank: false, tint: '#123456' });
    expect(decodeURIComponent(url)).toContain('&lt;7&gt;');
  });

  it('parses the ?demo flag', () => {
    expect(isDemoRequested('?demo')).toBe(true);
    expect(isDemoRequested('?demo=1')).toBe(true);
    expect(isDemoRequested('?demo=0')).toBe(false);
    expect(isDemoRequested('?x=1')).toBe(false);
    expect(isDemoRequested('')).toBe(false);
  });
});
