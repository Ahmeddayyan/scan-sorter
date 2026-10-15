import { describe, expect, it } from 'vitest';
import type { ExportPage } from '../../core';
import {
  A4_HEIGHT,
  A4_WIDTH,
  combineRotation,
  fitImageToPage,
  groupRuns,
  normalizeFileName,
  readJpegOrientation,
  sniffImageType,
} from '../helpers';

const page = (sourceFileId: string, sourceIndex: number, kind: ExportPage['kind'] = 'pdf-page'): ExportPage => ({
  pageId: `${sourceFileId}-p${sourceIndex + 1}`,
  sourceFileId,
  sourceIndex,
  kind,
  rotation: 0,
  number: null,
});

describe('fitImageToPage', () => {
  it('fits portrait images into A4 portrait, preserving aspect ratio', () => {
    const size = fitImageToPage(1500, 2000);
    expect(size.height).toBeLessThanOrEqual(A4_HEIGHT + 1e-9);
    expect(size.width).toBeLessThanOrEqual(A4_WIDTH + 1e-9);
    expect(size.width / size.height).toBeCloseTo(0.75, 6);
    // 4:3 is wider than A4 (1:1.414), so width is the binding side
    expect(size.width).toBeCloseTo(A4_WIDTH, 6);
  });

  it('uses A4 landscape for wide images and scales small images up', () => {
    const size = fitImageToPage(400, 200);
    expect(size.width).toBeCloseTo(A4_HEIGHT, 6);
    expect(size.height).toBeCloseTo(A4_HEIGHT / 2, 6);
  });

  it('gives an exact A4 sheet for A4-shaped scans', () => {
    const size = fitImageToPage(2480, 3508);
    expect(size.width).toBeCloseTo(A4_WIDTH, 0);
    expect(size.height).toBeCloseTo(A4_HEIGHT, 0);
  });

  it('survives degenerate sizes', () => {
    const size = fitImageToPage(0, 0);
    expect(Number.isFinite(size.width)).toBe(true);
    expect(size.width).toBeGreaterThan(0);
  });
});

describe('groupRuns', () => {
  it('merges consecutive pages of one PDF and keeps images separate', () => {
    const runs = groupRuns([
      page('a', 2),
      page('a', 0),
      page('b', 1),
      page('a', 3),
      page('i1', 0, 'image'),
      page('i1', 0, 'image'),
      page('a', 4),
    ]);
    expect(runs.map((r) => [r.kind, r.sourceFileId, r.pages.map((p) => p.sourceIndex)])).toEqual([
      ['pdf', 'a', [2, 0]],
      ['pdf', 'b', [1]],
      ['pdf', 'a', [3]],
      ['image', 'i1', [0]],
      ['image', 'i1', [0]],
      ['pdf', 'a', [4]],
    ]);
  });

  it('handles an empty plan', () => {
    expect(groupRuns([])).toEqual([]);
  });
});

describe('combineRotation', () => {
  it('adds and normalises', () => {
    expect(combineRotation(0, 90)).toBe(90);
    expect(combineRotation(270, 90)).toBe(0);
    expect(combineRotation(90, 270)).toBe(0);
    expect(combineRotation(180, 180)).toBe(0);
    expect(combineRotation(-90, 0)).toBe(270);
  });
});

describe('sniffImageType', () => {
  it('recognises JPEG, PNG and WebP by magic bytes', () => {
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('jpeg');
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(sniffImageType(webp)).toBe('webp');
    expect(sniffImageType(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});

/** Build a minimal JPEG prefix with an EXIF APP1 segment carrying the given orientation. */
function jpegWithOrientation(orientation: number, littleEndian: boolean): Uint8Array {
  const u16 = (v: number): number[] => (littleEndian ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number): number[] =>
    littleEndian ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1), // one IFD entry
    ...u16(0x0112),
    ...u16(3), // SHORT
    ...u32(1),
    ...u16(orientation),
    0,
    0,
    ...u32(0),
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = exif.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...exif, 0xff, 0xda, 0, 2]);
}

describe('readJpegOrientation', () => {
  it('reads both byte orders', () => {
    expect(readJpegOrientation(jpegWithOrientation(6, true))).toBe(6);
    expect(readJpegOrientation(jpegWithOrientation(3, false))).toBe(3);
    expect(readJpegOrientation(jpegWithOrientation(1, true))).toBe(1);
  });

  it('defaults to 1 for missing / garbage data', () => {
    expect(readJpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
    expect(readJpegOrientation(Uint8Array.from([1, 2, 3, 4]))).toBe(1);
    expect(readJpegOrientation(new Uint8Array(0))).toBe(1);
    expect(readJpegOrientation(jpegWithOrientation(9, true))).toBe(1);
    const truncated = jpegWithOrientation(6, true).slice(0, 14);
    expect(readJpegOrientation(truncated)).toBe(1);
  });
});

describe('normalizeFileName', () => {
  it('keeps good names, adds .pdf and strips illegal characters', () => {
    expect(normalizeFileName('book-sorted.pdf', 'x.pdf')).toBe('book-sorted.pdf');
    expect(normalizeFileName('my scan', 'x.pdf')).toBe('my scan.pdf');
    expect(normalizeFileName('a/b:c?.PDF', 'x.pdf')).toBe('a-b-c-.PDF');
    expect(normalizeFileName(undefined, 'plan-sorted.pdf')).toBe('plan-sorted.pdf');
    expect(normalizeFileName('  ', '')).toBe('scans-sorted.pdf');
  });
});
