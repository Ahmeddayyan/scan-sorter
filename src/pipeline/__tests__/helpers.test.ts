import { describe, expect, it } from 'vitest';
import {
  BoundedQueue,
  detectFileKind,
  enhanceForOcr,
  fullPageScale,
  imageBandScale,
  lumaFromRgba,
  mapTextContentItems,
  ocrBlocksToItems,
  pdfBandScale,
  resolveWorkerCount,
  rotatedSize,
  scaleToFit,
  scaledSize,
} from '../helpers';
import { bandRects } from '../../core';

describe('detectFileKind', () => {
  it('detects by MIME type', () => {
    expect(detectFileKind('x', 'application/pdf')?.kind).toBe('pdf');
    expect(detectFileKind('x', 'image/jpeg')).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
    expect(detectFileKind('x', 'IMAGE/PNG')?.mimeType).toBe('image/png');
    expect(detectFileKind('x', 'image/webp')?.mimeType).toBe('image/webp');
  });

  it('falls back to the extension for empty / generic MIME types', () => {
    expect(detectFileKind('Scan 01.JPG', '')?.mimeType).toBe('image/jpeg');
    expect(detectFileKind('doc.pdf', 'application/octet-stream')?.kind).toBe('pdf');
    expect(detectFileKind('photo.webp', '')?.mimeType).toBe('image/webp');
  });

  it('rejects unsupported files', () => {
    expect(detectFileKind('a.gif', 'image/gif')).toBeNull();
    expect(detectFileKind('a.heic', 'image/heic')).toBeNull();
    expect(detectFileKind('a.docx', '')).toBeNull();
    expect(detectFileKind('noextension', '')).toBeNull();
    // a lying extension does not rescue a known-but-unsupported MIME type
    expect(detectFileKind('a.pdf', 'text/plain')).toBeNull();
  });
});

describe('scales and geometry', () => {
  it('renders PDF bands at ~300 dpi, capped by width', () => {
    expect(pdfBandScale(612)).toBeCloseTo(300 / 72, 5);
    const wide = pdfBandScale(2000);
    expect(wide * 2000).toBeLessThanOrEqual(3200 + 1e-6);
    // A4 band: 595 pt wide -> ~2479 px, 15 % tall -> ~526 px
    const rect = bandRects(595, 842).bottom;
    const size = scaledSize(rect.width, rect.height, pdfBandScale(595));
    expect(size.width).toBeGreaterThan(2400);
    expect(size.width).toBeLessThanOrEqual(2500);
    expect(size.height).toBeLessThan(600);
  });

  it('scales image bands into a sane range', () => {
    expect(imageBandScale(4000)).toBeCloseTo(0.7, 5);
    expect(imageBandScale(2000)).toBe(1);
    expect(imageBandScale(700)).toBe(2);
    expect(imageBandScale(1000)).toBeCloseTo(1.4, 5);
  });

  it('caps the full-page fallback by pixel count and side', () => {
    const s = fullPageScale(612, 792, 'pdf-page');
    expect(s).toBeCloseTo(150 / 72, 5);
    const huge = fullPageScale(10000, 14000, 'image');
    expect(10000 * huge * 14000 * huge).toBeLessThanOrEqual(6_000_000 * 1.001);
    expect(14000 * huge).toBeLessThanOrEqual(3200 + 1e-6);
  });

  it('computes fit scales and rotated sizes', () => {
    expect(scaleToFit(600, 800, 240)).toBeCloseTo(0.3, 5);
    expect(scaledSize(612, 118.8, 2)).toEqual({ width: 1224, height: 238 });
    expect(rotatedSize(100, 200, 90)).toEqual({ width: 200, height: 100 });
    expect(rotatedSize(100, 200, 180)).toEqual({ width: 100, height: 200 });
    expect(rotatedSize(100, 200, 270)).toEqual({ width: 200, height: 100 });
    expect(rotatedSize(100, 200, 0)).toEqual({ width: 100, height: 200 });
  });

  it('resolves the OCR worker count', () => {
    expect(resolveWorkerCount(undefined, 8)).toBe(4);
    expect(resolveWorkerCount(undefined, 4)).toBe(3);
    expect(resolveWorkerCount(undefined, 2)).toBe(2);
    expect(resolveWorkerCount(undefined, undefined)).toBe(3);
    expect(resolveWorkerCount(1, 8)).toBe(1);
    expect(resolveWorkerCount(99, 8)).toBe(8);
  });
});

describe('mapTextContentItems', () => {
  // identity-ish converter for an unrotated 600x800 page: flip y like pdf.js does
  const convert = (r: [number, number, number, number]): number[] => [r[0], 800 - r[1], r[2], 800 - r[3]];

  it('maps baseline-left PDF rects to normalised y-down boxes', () => {
    const items = mapTextContentItems(
      [{ str: 'Page 3 of 9', transform: [10, 0, 0, 10, 270, 40], width: 60, height: 10 }],
      convert,
      600,
      800,
    );
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Page 3 of 9');
    expect(items[0].confidence).toBe(1);
    expect(items[0].box.x).toBeCloseTo(270 / 600, 6);
    expect(items[0].box.w).toBeCloseTo(60 / 600, 6);
    expect(items[0].box.y).toBeCloseTo((800 - 50) / 800, 6); // top edge of the glyphs
    expect(items[0].box.h).toBeCloseTo(10 / 800, 6);
  });

  it('skips blanks, marked-content entries and non-finite geometry', () => {
    const items = mapTextContentItems(
      [
        { str: '   ', transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1 },
        { type: 'beginMarkedContent', id: 'x' },
        { str: 'ok', transform: [1, 0, 0, 1, Number.NaN, 0], width: 1, height: 1 },
        { str: '7', transform: [1, 0, 0, 1, 5, 5], width: 4, height: 0 }, // height falls back to matrix scale
      ],
      convert,
      600,
      800,
    );
    expect(items.map((i) => i.text)).toEqual(['7']);
    expect(items[0].box.h).toBeGreaterThan(0);
  });

  it('returns nothing for a degenerate viewport', () => {
    expect(mapTextContentItems([{ str: 'a', transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1 }], convert, 0, 0)).toEqual([]);
  });
});

describe('ocrBlocksToItems', () => {
  const page = { width: 1000, height: 2000 };
  const band = bandRects(page.width, page.height).bottom; // y = 1700, 1000 x 300

  it('flattens blocks and maps crop pixels back onto the page (crop is 2x the band)', () => {
    const blocks = [
      {
        paragraphs: [
          {
            lines: [
              {
                words: [
                  { text: 'Page', confidence: 90, bbox: { x0: 800, y0: 100, x1: 900, y1: 140 } },
                  { text: '  ', confidence: 99, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
                  { text: '12', confidence: 150, bbox: { x0: 920, y0: 100, x1: 1000, y1: 140 } },
                ],
              },
            ],
          },
        ],
      },
    ];
    const items = ocrBlocksToItems(blocks, band, page, { width: 2000, height: 600 });
    expect(items.map((i) => i.text)).toEqual(['Page', '12']);
    expect(items[0].confidence).toBeCloseTo(0.9, 6);
    expect(items[1].confidence).toBe(1); // clamped
    expect(items[0].box.x).toBeCloseTo(400 / 1000, 6);
    expect(items[0].box.w).toBeCloseTo(50 / 1000, 6);
    expect(items[0].box.y).toBeCloseTo((1700 + 50) / 2000, 6);
    expect(items[0].box.h).toBeCloseTo(20 / 2000, 6);
  });

  it('handles null / empty blocks', () => {
    expect(ocrBlocksToItems(null, band, page, { width: 1, height: 1 })).toEqual([]);
    expect(ocrBlocksToItems([{ paragraphs: [] }], band, page, { width: 1, height: 1 })).toEqual([]);
  });
});

describe('enhanceForOcr', () => {
  const rgba = (values: number[]): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(values.length * 4);
    values.forEach((v, i) => data.set([v, v, v, 255], i * 4));
    return data;
  };

  it('stretches a washed-out scan to full contrast', () => {
    const values = Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? 90 : 200));
    const data = rgba(values);
    enhanceForOcr(data);
    const out = Array.from({ length: 1000 }, (_, i) => data[i * 4]);
    expect(Math.min(...out)).toBeLessThan(5);
    expect(Math.max(...out)).toBeGreaterThan(250);
    expect(data[1]).toBe(data[0]);
    expect(data[3]).toBe(255);
  });

  it('does not amplify nearly flat input', () => {
    const data = rgba(Array.from({ length: 400 }, (_, i) => 240 + (i % 5)));
    enhanceForOcr(data);
    expect(data[0]).toBeGreaterThanOrEqual(238);
    expect(Math.max(...Array.from({ length: 400 }, (_, i) => data[i * 4]))).toBeLessThanOrEqual(244);
  });

  it('greys colour pixels', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    enhanceForOcr(data);
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
  });
});

describe('lumaFromRgba', () => {
  it('uses Rec.601 luma', () => {
    const gray = lumaFromRgba([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    expect(gray[0]).toBeCloseTo(76.245, 3);
    expect(gray[1]).toBeCloseTo(149.685, 3);
    expect(gray[2]).toBeCloseTo(29.07, 3);
  });
});

describe('BoundedQueue', () => {
  it('delivers in order and applies back-pressure', async () => {
    const q = new BoundedQueue<number>(2);
    const order: string[] = [];
    const producer = (async () => {
      for (let i = 1; i <= 5; i += 1) {
        await q.push(i);
        order.push(`pushed ${i}`);
      }
      q.close();
    })();
    await new Promise((r) => setTimeout(r, 10));
    // capacity 2, nobody consuming: only two pushes completed
    expect(order).toEqual(['pushed 1', 'pushed 2']);
    const got: number[] = [];
    for (;;) {
      const v = await q.pull();
      if (v === null) break;
      got.push(v);
    }
    await producer;
    expect(got).toEqual([1, 2, 3, 4, 5]);
  });

  it('wakes waiting consumers on close and rejects pushes afterwards', async () => {
    const q = new BoundedQueue<string>(1);
    const waiting = q.pull();
    q.close();
    expect(await waiting).toBeNull();
    expect(await q.push('x')).toBe(false);
  });

  it('hands an item straight to a waiting consumer', async () => {
    const q = new BoundedQueue<string>(1);
    const waiting = q.pull();
    expect(await q.push('a')).toBe(true);
    expect(await waiting).toBe('a');
    expect(q.size).toBe(0);
  });

  it('drain() empties the queue and unblocks producers on close', async () => {
    const q = new BoundedQueue<number>(1);
    await q.push(1);
    const blocked = q.push(2);
    q.close();
    expect(await blocked).toBe(false);
    expect(q.drain()).toEqual([1]);
    expect(await q.pull()).toBeNull();
  });

  it('bounds how far a fast producer runs ahead of a slow consumer', async () => {
    const q = new BoundedQueue<number>(3);
    let produced = 0;
    let consumed = 0;
    let maxAhead = 0;
    const producer = (async () => {
      for (let i = 0; i < 30; i += 1) {
        if (!(await q.push(i))) return;
        produced += 1;
        maxAhead = Math.max(maxAhead, produced - consumed);
      }
      q.close();
    })();
    for (;;) {
      const v = await q.pull();
      if (v === null) break;
      await new Promise((r) => setTimeout(r, 1));
      consumed += 1;
    }
    await producer;
    expect(consumed).toBe(30);
    expect(maxAhead).toBeLessThanOrEqual(4); // capacity + the item in flight
  });
});
