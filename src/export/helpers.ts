/** Pure helpers of the PDF export (no DOM, no pdf-lib): unit-tested in Node. */
import type { ExportPage } from '../core';

/** ISO A4 in PDF points (1/72 in). */
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

/**
 * Page size for an image page: the image is scaled (up or down) to fit an A4 sheet in the
 * image's own orientation, keeping its aspect ratio - so a phone photo or flatbed scan prints
 * at a sensible physical size instead of "4000 pt wide at 72 dpi".
 */
export function fitImageToPage(
  pixelWidth: number,
  pixelHeight: number,
): { width: number; height: number } {
  const w = Math.max(1, pixelWidth);
  const h = Math.max(1, pixelHeight);
  const boxW = w > h ? A4_HEIGHT : A4_WIDTH;
  const boxH = w > h ? A4_WIDTH : A4_HEIGHT;
  const scale = Math.min(boxW / w, boxH / h);
  return { width: w * scale, height: h * scale };
}

export type PlanRun =
  | { kind: 'pdf'; sourceFileId: string; pages: ExportPage[] }
  | { kind: 'image'; sourceFileId: string; pages: ExportPage[] };

/**
 * Group consecutive PDF pages of the same source so they can be copied with one `copyPages`
 * call. Image pages are never merged (each is embedded individually).
 */
export function groupRuns(pages: readonly ExportPage[]): PlanRun[] {
  const runs: PlanRun[] = [];
  for (const page of pages) {
    const last = runs[runs.length - 1];
    if (page.kind === 'pdf-page' && last && last.kind === 'pdf' && last.sourceFileId === page.sourceFileId) {
      last.pages.push(page);
    } else {
      runs.push({ kind: page.kind === 'pdf-page' ? 'pdf' : 'image', sourceFileId: page.sourceFileId, pages: [page] });
    }
  }
  return runs;
}

/** New /Rotate value: the page's own rotation plus the user's, normalised to 0/90/180/270. */
export function combineRotation(existing: number, extra: number): number {
  return (((existing + extra) % 360) + 360) % 360;
}

export type SniffedImageType = 'jpeg' | 'png' | 'webp' | null;

/** Identify an image by magic bytes (File.type can be empty or wrong). */
export function sniffImageType(bytes: Uint8Array): SniffedImageType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * EXIF orientation (1..8) of a JPEG, or 1 when absent / unreadable. PDF viewers ignore EXIF,
 * so an image with orientation != 1 must be re-encoded upright before embedding.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return 1; // image data / end: no EXIF found
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return 1;
    if (marker === 0xe1 && offset + 4 + 6 <= bytes.length) {
      const start = offset + 4;
      const isExif =
        bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66;
      if (isExif) return readTiffOrientation(bytes, start + 6, Math.min(bytes.length, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return 1;
}

function readTiffOrientation(bytes: Uint8Array, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return 1;
  const u16 = (o: number): number => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
  const u32 = (o: number): number =>
    little
      ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
      : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  if (u16(tiff + 2) !== 42) return 1;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Make a safe `.pdf` file name. */
export function normalizeFileName(name: string | undefined, fallback: string): string {
  const raw = (name ?? '').trim() || fallback.trim() || 'scans-sorted.pdf';
  const noControls = Array.from(raw, (c) => (c.charCodeAt(0) < 32 ? '-' : c)).join('');
  const cleaned = noControls.replace(/[\\/:*?"<>|]+/g, '-');
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}
