/** Image inputs (JPG/PNG/WebP) as single pages. EXIF orientation is applied at decode time. */
import type { PixelRect, Rotation } from '../core';
import { createCanvas, fillWhite, getContext } from './canvas';
import type { AnyCanvas } from './canvas';
import { rotatedSize, scaledSize, scaleToFit } from './helpers';
import type { PageSource } from './source';

export function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

function drawRegion(bitmap: ImageBitmap, rect: PixelRect, scale: number): AnyCanvas {
  const size = scaledSize(rect.width, rect.height, scale);
  const canvas = createCanvas(size.width, size.height);
  const ctx = getContext(canvas);
  fillWhite(canvas, ctx);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height);
  return canvas;
}

export class ImagePageSource implements PageSource {
  readonly kind = 'image' as const;
  readonly width: number;
  readonly height: number;
  private readonly file: Blob;
  private bitmap: ImageBitmap | null;

  private constructor(file: Blob, bitmap: ImageBitmap) {
    this.file = file;
    this.bitmap = bitmap;
    this.width = bitmap.width;
    this.height = bitmap.height;
  }

  static async open(file: Blob): Promise<ImagePageSource> {
    return new ImagePageSource(file, await decodeImage(file));
  }

  /** Decoded bitmap, re-decoded on demand after `trim()`. */
  private async ensureBitmap(): Promise<ImageBitmap> {
    this.bitmap ??= await decodeImage(this.file);
    return this.bitmap;
  }

  async renderThumbnail(maxSize: number): Promise<AnyCanvas> {
    return drawRegion(
      await this.ensureBitmap(),
      { x: 0, y: 0, width: this.width, height: this.height },
      scaleToFit(this.width, this.height, maxSize),
    );
  }

  async renderRegion(rect: PixelRect, scale: number): Promise<AnyCanvas> {
    return drawRegion(await this.ensureBitmap(), rect, scale);
  }

  trim(): void {
    this.bitmap?.close();
    this.bitmap = null;
  }

  dispose(): void {
    this.trim();
  }
}

/** Whole image rotated clockwise by `rotation`, longest side `maxSize` (never upscaled beyond 1:1 x2). */
export async function renderImagePreview(file: Blob, maxSize: number, rotation: Rotation): Promise<AnyCanvas> {
  const bitmap = await decodeImage(file);
  try {
    const out = rotatedSize(bitmap.width, bitmap.height, rotation);
    const scale = scaleToFit(out.width, out.height, maxSize);
    const size = scaledSize(out.width, out.height, scale);
    const canvas = createCanvas(size.width, size.height);
    const ctx = getContext(canvas);
    fillWhite(canvas, ctx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(size.width / 2, size.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    return canvas;
  } finally {
    bitmap.close();
  }
}
