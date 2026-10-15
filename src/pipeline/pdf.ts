/**
 * pdf.js integration: loading (same-origin worker, self-hosted wasm/fonts/cmaps), upright page
 * sources, text-layer extraction. pdfjs-dist is imported lazily so it stays out of the
 * initial bundle.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PixelRect, Rotation, TextItem } from '../core';
import { createCanvas, fillWhite, getContext } from './canvas';
import type { AnyCanvas } from './canvas';
import { mapTextContentItems, rotatedSize, scaledSize, scaleToFit } from './helpers';
import type { PageSource } from './source';

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })().catch((error: unknown) => {
    pdfjsPromise = null;
    throw error;
  });
  return pdfjsPromise;
}

/** Open a PDF from a File/Blob. The caller must `destroy()` the returned document. */
export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const base = import.meta.env.BASE_URL;
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    wasmUrl: `${base}pdfjs/wasm/`,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    iccUrl: `${base}pdfjs/iccs/`,
  });
  try {
    return await task.promise;
  } catch (error) {
    void task.destroy().catch(() => undefined);
    throw error;
  }
}

/** Positioned text of a page as normalised upright items (see ARCHITECTURE 5.1). */
export async function extractTextLayer(page: PDFPageProxy): Promise<TextItem[]> {
  const content = await page.getTextContent();
  const vp1 = page.getViewport({ scale: 1 });
  return mapTextContentItems(content.items, (rect) => {
      const [ax, ay] = vp1.convertToViewportPoint(rect[0], rect[1]) as [number, number];
      const [bx, by] = vp1.convertToViewportPoint(rect[2], rect[3]) as [number, number];
      return [ax, ay, bx, by];
    }, vp1.width, vp1.height);
}

/**
 * Render `region` (scale-1 upright units) at `scale` onto a fresh white canvas. `rotation` is
 * an extra user rotation (multiple of 90) applied on top of the page's own /Rotate; for a
 * rotated render the region is interpreted in the rotated space.
 */
export async function renderPdfRegion(
  page: PDFPageProxy,
  region: PixelRect,
  scale: number,
  extraRotation = 0,
): Promise<AnyCanvas> {
  const rotation = (((page.rotate + extraRotation) % 360) + 360) % 360;
  const viewport = page.getViewport({
    scale,
    rotation,
    offsetX: -region.x * scale,
    offsetY: -region.y * scale,
  });
  const size = scaledSize(region.width, region.height, scale);
  const canvas = createCanvas(size.width, size.height);
  const ctx = getContext(canvas);
  fillWhite(canvas, ctx);
  const task = page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as CanvasRenderingContext2D,
    viewport,
    background: '#ffffff',
  });
  await task.promise;
  return canvas;
}

export class PdfPageSource implements PageSource {
  readonly kind = 'pdf-page' as const;
  readonly width: number;
  readonly height: number;
  private readonly page: PDFPageProxy;

  private constructor(page: PDFPageProxy, width: number, height: number) {
    this.page = page;
    this.width = width;
    this.height = height;
  }

  static async open(doc: PDFDocumentProxy, index: number): Promise<PdfPageSource> {
    const page = await doc.getPage(index + 1);
    const vp = page.getViewport({ scale: 1 });
    return new PdfPageSource(page, vp.width, vp.height);
  }

  readTextLayer(): Promise<TextItem[]> {
    return extractTextLayer(this.page);
  }

  renderThumbnail(maxSize: number): Promise<AnyCanvas> {
    return renderPdfRegion(this.page, { x: 0, y: 0, width: this.width, height: this.height }, scaleToFit(this.width, this.height, maxSize));
  }

  renderRegion(rect: PixelRect, scale: number): Promise<AnyCanvas> {
    return renderPdfRegion(this.page, rect, scale);
  }

  trim(): void {
    this.page.cleanup();
  }

  dispose(): void {
    this.trim();
  }
}

/** Render a whole page to fit `maxSize` with a user rotation; returns the canvas. */
export async function renderPdfPreview(
  doc: PDFDocumentProxy,
  index: number,
  maxSize: number,
  rotation: Rotation,
): Promise<AnyCanvas> {
  const page = await doc.getPage(index + 1);
  try {
    const vp = page.getViewport({ scale: 1 });
    const upright = rotatedSize(vp.width, vp.height, rotation);
    const scale = scaleToFit(upright.width, upright.height, maxSize);
    return await renderPdfRegion(page, { x: 0, y: 0, width: upright.width, height: upright.height }, scale, rotation);
  } finally {
    page.cleanup();
  }
}
