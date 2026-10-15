import { describe, expect, it } from 'vitest';
import { bandRects, DEFAULT_BANDS } from '../../core';
import type { TextItem } from '../../core';
import { hasUsableCandidate, pickBest, prepareAnalysis, runOcr } from '../analyze';
import type { Analysis, AnalysisSettings, BandCrop, Prepared } from '../analyze';
import type { OcrBlockLike } from '../helpers';
import type { PageSource } from '../source';

const settings: AnalysisSettings = { ocr: 'auto', fallbackFullPageOcr: false, bands: DEFAULT_BANDS };

function fakeSource(textItems: TextItem[] | null, width = 600, height = 800): PageSource {
  return {
    kind: 'pdf-page',
    width,
    height,
    readTextLayer: textItems === null ? undefined : () => Promise.resolve(textItems),
    renderThumbnail: () => Promise.reject(new Error('not used')),
    renderRegion: () => Promise.reject(new Error('not used')),
    trim: () => undefined,
    dispose: () => undefined,
  };
}

const footerItem = (text: string): TextItem => ({
  text,
  box: { x: 0.47, y: 0.94, w: 0.06, h: 0.012 },
  confidence: 1,
});

function word(text: string, x0: number, y0: number, x1: number, y1: number, confidence = 95) {
  return { text, confidence, bbox: { x0, y0, x1, y1 } };
}
const blocksOf = (...words: ReturnType<typeof word>[]): OcrBlockLike[] => [{ paragraphs: [{ lines: [{ words }] }] }];

function crops(width = 600, height = 800): BandCrop[] {
  const rects = bandRects(width, height);
  // crops rendered at 2x
  return (['top', 'bottom'] as const).map((band) => ({
    band,
    rect: rects[band],
    blob: new Blob([band]),
    cropWidth: rects[band].width * 2,
    cropHeight: rects[band].height * 2,
  }));
}

describe('prepareAnalysis', () => {
  it('accepts a text layer that has a footer number', async () => {
    const prepared = await prepareAnalysis(fakeSource([footerItem('12')]), settings);
    expect(prepared.kind).toBe('final');
    if (prepared.kind !== 'final') return;
    expect(prepared.evidence.source).toBe('text-layer');
    expect(prepared.evidence.hasTextLayer).toBe(true);
    expect(prepared.candidates[0].number).toEqual({ value: 12, style: 'arabic' });
    expect(prepared.candidates[0].region).toBe('bottom-center');
  });

  it('with ocr "never" never falls back to OCR', async () => {
    const prepared = await prepareAnalysis(fakeSource([]), { ...settings, ocr: 'never' });
    expect(prepared.kind).toBe('final');
    if (prepared.kind !== 'final') return;
    expect(prepared.evidence.hasTextLayer).toBe(false);
    expect(prepared.evidence.source).toBe('none');
    expect(prepared.candidates).toEqual([]);
  });

  it('with ocr "never" and no text layer (image) returns empty evidence', async () => {
    const prepared = await prepareAnalysis(fakeSource(null), { ...settings, ocr: 'never' });
    expect(prepared.kind).toBe('final');
  });
});

describe('runOcr', () => {
  const prepared: Extract<Prepared, { kind: 'ocr' }> = {
    kind: 'ocr',
    crops: crops(),
    textFallback: null,
    hasTextLayer: false,
  };

  it('maps band words onto the page and extracts the footer number', async () => {
    const seen: string[] = [];
    const analysis = await runOcr(fakeSource(null), prepared, settings, (blob) => {
      seen.push(String(blob.size));
      // bottom band crop is 1200 x 240: centre footer "17"
      return Promise.resolve(
        blob.size === 'bottom'.length ? blocksOf(word('17', 570, 150, 630, 190)) : blocksOf(word('Header', 100, 40, 300, 80)),
      );
    });
    expect(seen).toHaveLength(2);
    expect(analysis.evidence.source).toBe('ocr');
    expect(analysis.evidence.bands).toEqual(['top', 'bottom']);
    const best = analysis.candidates[0];
    expect(best.number).toEqual({ value: 17, style: 'arabic' });
    expect(best.region).toBe('bottom-center');
    expect(best.box.y).toBeGreaterThan(0.9);
    expect(best.textConfidence).toBeCloseTo(0.95, 2);
  });

  it('keeps a non-empty text layer when OCR finds no number', async () => {
    const text: Analysis = {
      evidence: { source: 'text-layer', bands: ['full'], items: [footerItem('blah')], hasTextLayer: true },
      candidates: [],
    };
    const analysis = await runOcr(
      fakeSource([footerItem('blah')]),
      { ...prepared, textFallback: text, hasTextLayer: true },
      settings,
      () => Promise.resolve([]),
    );
    expect(analysis.evidence.source).toBe('text-layer');
    expect(analysis.evidence.hasTextLayer).toBe(true);
  });

  it('propagates recognition failures to the caller', async () => {
    await expect(runOcr(fakeSource(null), prepared, settings, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});

describe('pickBest / hasUsableCandidate', () => {
  const ocrWith = (n: number): Analysis => ({
    evidence: { source: 'ocr', bands: ['top', 'bottom'], items: [], hasTextLayer: false },
    candidates: Array.from({ length: n }, () => ({}) as Analysis['candidates'][number]),
  });

  it('prefers OCR with candidates, then non-empty text, then OCR', () => {
    const text: Analysis = {
      evidence: { source: 'text-layer', bands: ['full'], items: [footerItem('x')], hasTextLayer: true },
      candidates: [],
    };
    expect(pickBest(ocrWith(1), text).evidence.source).toBe('ocr');
    expect(pickBest(ocrWith(0), text).evidence.source).toBe('text-layer');
    expect(pickBest(ocrWith(0), null).evidence.source).toBe('ocr');
  });

  it('treats body-only candidates as unusable', () => {
    expect(hasUsableCandidate([])).toBe(false);
    expect(hasUsableCandidate([{ region: 'body' } as Analysis['candidates'][number]])).toBe(false);
    expect(hasUsableCandidate([{ region: 'top-right' } as Analysis['candidates'][number]])).toBe(true);
  });
});
