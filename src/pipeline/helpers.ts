/**
 * Pure helpers of the pipeline (no DOM, no pdf.js, no tesseract): geometry, mapping,
 * file-type detection, pixel preprocessing and a bounded async queue. Unit-tested in Node.
 */
import { normalizeBandBox, normalizeBox } from '../core';
import type { PixelRect, TextItem } from '../core';

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------

export interface DetectedKind {
  kind: 'pdf' | 'image';
  mimeType: string;
}

const PDF: DetectedKind = { kind: 'pdf', mimeType: 'application/pdf' };
const JPEG: DetectedKind = { kind: 'image', mimeType: 'image/jpeg' };
const PNG: DetectedKind = { kind: 'image', mimeType: 'image/png' };
const WEBP: DetectedKind = { kind: 'image', mimeType: 'image/webp' };

const EXTENSION_TYPES: Record<string, DetectedKind> = {
  pdf: PDF,
  jpg: JPEG,
  jpeg: JPEG,
  jfif: JPEG,
  png: PNG,
  webp: WEBP,
};

const MIME_TYPES: Record<string, DetectedKind> = {
  'application/pdf': PDF,
  'application/x-pdf': PDF,
  'image/jpeg': JPEG,
  'image/jpg': JPEG,
  'image/pjpeg': JPEG,
  'image/png': PNG,
  'image/webp': WEBP,
};

/** Detect a supported input type by MIME first, then by extension. `null` = unsupported. */
export function detectFileKind(name: string, mimeType: string): DetectedKind | null {
  const mime = mimeType.trim().toLowerCase();
  const byMime = MIME_TYPES[mime];
  if (byMime) return byMime;
  // A known-but-unsupported MIME (gif, heic, tiff, ...) is rejected even if the extension
  // claims otherwise; only an empty / generic MIME falls back to the extension.
  if (mime !== '' && mime !== 'application/octet-stream') return null;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? (EXTENSION_TYPES[ext] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Scales and crop geometry
// ---------------------------------------------------------------------------

/** OCR target resolution for PDF bands, and caps. */
export const BAND_DPI = 300;
export const BAND_MAX_WIDTH_PX = 3200;
export const FULL_PAGE_DPI = 150;
export const FULL_PAGE_MAX_PIXELS = 6_000_000;
export const FULL_PAGE_MAX_SIDE_PX = 3200;

/** pdf.js scale (device px per PDF point) for rendering a band at ~300 dpi, width-capped. */
export function pdfBandScale(pageWidthPts: number): number {
  const target = BAND_DPI / 72;
  return Math.max(0.1, Math.min(target, BAND_MAX_WIDTH_PX / Math.max(1, pageWidthPts)));
}

/**
 * Scale for a photo/scan image band: downscale very wide images (tesseract does not need
 * more than ~2800 px), upscale small ones (up to 2x) so text is at least ~1400 px across.
 */
export function imageBandScale(widthPx: number): number {
  if (widthPx > 2800) return 2800 / widthPx;
  if (widthPx < 1400) return Math.min(2, 1400 / Math.max(1, widthPx));
  return 1;
}

/** Scale for a full-page fallback render, bounded by dpi (PDF only), pixel count and side length. */
export function fullPageScale(widthUnits: number, heightUnits: number, kind: 'pdf-page' | 'image'): number {
  const w = Math.max(1, widthUnits);
  const h = Math.max(1, heightUnits);
  const wanted = kind === 'pdf-page' ? FULL_PAGE_DPI / 72 : 1;
  const byPixels = Math.sqrt(FULL_PAGE_MAX_PIXELS / (w * h));
  const bySide = FULL_PAGE_MAX_SIDE_PX / Math.max(w, h);
  return Math.max(0.05, Math.min(wanted, byPixels, bySide));
}

/** Scale that makes the longest side equal `maxSize` (never zero). */
export function scaleToFit(width: number, height: number, maxSize: number): number {
  return Math.max(1e-3, maxSize / Math.max(1, width, height));
}

/** Pixel size of a region rendered at `scale` (at least 1x1). */
export function scaledSize(width: number, height: number, scale: number): { width: number; height: number } {
  return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) };
}

/** Size after rotating a rectangle by a multiple of 90 degrees. */
export function rotatedSize(width: number, height: number, rotation: number): { width: number; height: number } {
  const quarter = ((Math.round(rotation / 90) % 4) + 4) % 4;
  return quarter % 2 === 1 ? { width: height, height: width } : { width, height };
}

// ---------------------------------------------------------------------------
// pdf.js text content -> TextItem
// ---------------------------------------------------------------------------

/** Convert a PDF user-space rectangle to viewport space (`PageViewport.convertToViewportRectangle`). */
export type RectConverter = (rect: [number, number, number, number]) => number[];

/** Minimal shape of a pdf.js `TextItem`. */
interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

function isRawTextItem(item: unknown): item is RawTextItem {
  if (typeof item !== 'object' || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return typeof candidate.str === 'string' && Array.isArray(candidate.transform);
}

/**
 * Map pdf.js text-content items to normalised upright `TextItem`s.
 * `viewportWidth/Height` is the scale-1 viewport (already includes the page's /Rotate).
 */
export function mapTextContentItems(
  items: readonly unknown[],
  convert: RectConverter,
  viewportWidth: number,
  viewportHeight: number,
): TextItem[] {
  const out: TextItem[] = [];
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return out;
  for (const item of items) {
    if (!isRawTextItem(item) || item.str.trim() === '') continue;
    const x0 = item.transform[4];
    const y0 = item.transform[5];
    // `height` is the font height; fall back to the vertical scale of the text matrix.
    const h = item.height > 0 ? item.height : Math.abs(item.transform[3] ?? 0);
    const r = convert([x0, y0, x0 + item.width, y0 + h]);
    if (r.length < 4 || r.some((v) => !Number.isFinite(v))) continue;
    const x = Math.min(r[0], r[2]);
    const y = Math.min(r[1], r[3]);
    out.push({
      text: item.str,
      box: normalizeBox(
        { x, y, width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]) },
        viewportWidth,
        viewportHeight,
      ),
      confidence: 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// tesseract.js v7 blocks -> TextItem
// ---------------------------------------------------------------------------

export interface OcrWordLike {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
export interface OcrBlockLike {
  paragraphs: { lines: { words: OcrWordLike[] }[] }[];
}

/** Flatten `blocks[].paragraphs[].lines[].words[]` into page-normalised `TextItem`s. */
export function ocrBlocksToItems(
  blocks: readonly OcrBlockLike[] | null | undefined,
  band: PixelRect,
  page: { width: number; height: number },
  crop: { width: number; height: number },
): TextItem[] {
  const items: TextItem[] = [];
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          if (!word.text || word.text.trim() === '') continue;
          const { x0, y0, x1, y1 } = word.bbox;
          items.push({
            text: word.text,
            box: normalizeBandBox({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, band, page, crop),
            confidence: Math.min(1, Math.max(0, (Number.isFinite(word.confidence) ? word.confidence : 0) / 100)),
          });
        }
      }
    }
  }
  return items;
}

/** Default worker count: clamp(hardwareConcurrency - 1, 2, 4), overridable (1..8). */
export function resolveWorkerCount(requested: number | undefined, hardwareConcurrency: number | undefined): number {
  if (requested !== undefined && Number.isFinite(requested)) return Math.min(8, Math.max(1, Math.round(requested)));
  return Math.min(4, Math.max(2, (hardwareConcurrency || 4) - 1));
}

// ---------------------------------------------------------------------------
// Pixel preprocessing
// ---------------------------------------------------------------------------

/**
 * In-place greyscale + contrast stretch of RGBA pixels. The 1st/99th luma percentiles are
 * mapped to 0/255. Low-contrast regions (range < 32, e.g. an empty band) are only greyed,
 * never amplified. No thresholding or sharpening: those can hurt more than help.
 */
export function enhanceForOcr(rgba: Uint8ClampedArray): void {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return;
  const hist = new Uint32Array(256);
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    const g = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]);
    rgba[o] = g;
    hist[g] += 1;
  }
  const clip = Math.max(1, Math.floor(pixels * 0.01));
  let lo = 0;
  let acc = 0;
  for (; lo < 255; lo += 1) {
    acc += hist[lo];
    if (acc > clip) break;
  }
  let hi = 255;
  acc = 0;
  for (; hi > 0; hi -= 1) {
    acc += hist[hi];
    if (acc > clip) break;
  }
  const range = hi - lo;
  const stretch = range >= 32;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) lut[v] = stretch ? ((v - lo) * 255) / range : v;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    const g = lut[rgba[o]];
    rgba[o] = g;
    rgba[o + 1] = g;
    rgba[o + 2] = g;
    rgba[o + 3] = 255;
  }
}

/** Luma (0.299R + 0.587G + 0.114B) per pixel, row-major, for the dHash input. */
export function lumaFromRgba(rgba: ArrayLike<number>): number[] {
  const n = Math.floor(rgba.length / 4);
  const gray = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    gray[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return gray;
}

// ---------------------------------------------------------------------------
// Bounded async queue
// ---------------------------------------------------------------------------

/**
 * Producer/consumer channel with back-pressure: `push` waits while `capacity` items are
 * queued (and no consumer is waiting), which keeps the render lane only a few pages ahead
 * of OCR. `close()` wakes everybody; consumers still receive items queued before the close.
 */
export class BoundedQueue<T> {
  private items: T[] = [];
  private pullers: ((value: T | null) => void)[] = [];
  private pushers: (() => void)[] = [];
  private closed = false;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.items.length;
  }

  /** Resolves `true` when queued, `false` when the queue was closed meanwhile. */
  async push(item: T): Promise<boolean> {
    while (!this.closed && this.items.length >= this.capacity && this.pullers.length === 0) {
      await new Promise<void>((resolve) => this.pushers.push(resolve));
    }
    if (this.closed) return false;
    const puller = this.pullers.shift();
    if (puller) puller(item);
    else this.items.push(item);
    return true;
  }

  /** Next item, or `null` once the queue is closed and empty. */
  pull(): Promise<T | null> {
    if (this.items.length > 0) {
      const item = this.items.shift() as T;
      this.pushers.shift()?.();
      return Promise.resolve(item);
    }
    if (this.closed) return Promise.resolve(null);
    return new Promise<T | null>((resolve) => this.pullers.push(resolve));
  }

  close(): void {
    this.closed = true;
    for (const puller of this.pullers.splice(0)) puller(null);
    for (const pusher of this.pushers.splice(0)) pusher();
  }

  /** Remove and return everything still queued (used on cancel). */
  drain(): T[] {
    return this.items.splice(0);
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function errorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message) {
    if (error.name === 'PasswordException') return 'The PDF is password-protected.';
    return error.message;
  }
  if (typeof error === 'string' && error) return error;
  return fallback;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
