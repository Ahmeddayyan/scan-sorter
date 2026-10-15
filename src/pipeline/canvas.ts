/**
 * Thin canvas layer: OffscreenCanvas when available, `<canvas>` otherwise. Everything that
 * touches browser pixels goes through here so the rest of the pipeline stays testable.
 */
import { dHashFromGray } from '../core';
import { enhanceForOcr, lumaFromRgba } from './helpers';

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
export type DrawSource = CanvasImageSource;

export function createCanvas(width: number, height: number): AnyCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

export function getContext(canvas: AnyCanvas, willReadFrequently = false): AnyContext {
  const ctx = canvas.getContext('2d', { willReadFrequently }) as AnyContext | null;
  if (!ctx) throw new Error('Could not create a 2D canvas context (out of memory?).');
  return ctx;
}

/** Fill with opaque white (PDF pages and transparent PNGs are rendered on white). */
export function fillWhite(canvas: AnyCanvas, ctx: AnyContext): void {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

export function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas could not be encoded.'))),
      type,
      quality,
    );
  });
}

/** Free the pixel buffer right away (matters on Safari, which holds canvas memory for long). */
export function releaseCanvas(canvas: AnyCanvas): void {
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    /* ignore */
  }
}

/** dHash of whatever is on `source` (thumbnail canvas or bitmap): 9x8 greyscale. */
export function perceptualHashOf(source: DrawSource): string {
  const small = createCanvas(9, 8);
  try {
    const ctx = getContext(small, true);
    fillWhite(small, ctx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, 9, 8);
    const data = ctx.getImageData(0, 0, 9, 8).data;
    return dHashFromGray(lumaFromRgba(data), 9, 8);
  } finally {
    releaseCanvas(small);
  }
}

/** Greyscale + contrast-stretch the canvas in place and encode it as PNG. */
export async function canvasToOcrPng(canvas: AnyCanvas): Promise<Blob> {
  const ctx = getContext(canvas, true);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhanceForOcr(image.data);
  ctx.putImageData(image, 0, 0);
  return canvasToBlob(canvas, 'image/png');
}
