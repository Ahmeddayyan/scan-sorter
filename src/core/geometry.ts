import { DEFAULT_BANDS } from './constants';
import type { BandConfig, NormBox, PageRegion, PixelRect } from './types';

export interface BandRects {
  top: PixelRect;
  bottom: PixelRect;
}

/**
 * Pixel rectangles of the header and footer bands for a page of the given size.
 * The pipeline crops these regions (at OCR resolution) before calling tesseract.
 */
export function bandRects(pageWidth: number, pageHeight: number, bands: BandConfig = DEFAULT_BANDS): BandRects {
  const topH = Math.max(1, Math.round(pageHeight * bands.top));
  const bottomH = Math.max(1, Math.round(pageHeight * bands.bottom));
  return {
    top: { x: 0, y: 0, width: pageWidth, height: topH },
    bottom: { x: 0, y: pageHeight - bottomH, width: pageWidth, height: bottomH },
  };
}

/** Convert a pixel rect on the full page into normalised page coordinates. */
export function normalizeBox(rect: PixelRect, pageWidth: number, pageHeight: number): NormBox {
  return clampBox({
    x: rect.x / pageWidth,
    y: rect.y / pageHeight,
    w: rect.width / pageWidth,
    h: rect.height / pageHeight,
  });
}

/**
 * Convert a word box reported relative to a band crop into normalised page coordinates.
 *
 * @param rectInCrop  box in the crop's own pixel space (what tesseract returns)
 * @param band        the band rect on the page (from {@link bandRects}), in page pixels
 * @param page        page size in the same pixel space as `band`
 * @param crop        actual pixel size of the crop bitmap handed to OCR, when it was
 *                    rendered at a different scale than `band` (e.g. 2x for better OCR)
 */
export function normalizeBandBox(
  rectInCrop: PixelRect,
  band: PixelRect,
  page: { width: number; height: number },
  crop?: { width: number; height: number },
): NormBox {
  const sx = crop ? band.width / crop.width : 1;
  const sy = crop ? band.height / crop.height : 1;
  return normalizeBox(
    {
      x: band.x + rectInCrop.x * sx,
      y: band.y + rectInCrop.y * sy,
      width: rectInCrop.width * sx,
      height: rectInCrop.height * sy,
    },
    page.width,
    page.height,
  );
}

/** Clamp a normalised box into [0,1] (guards against tiny overshoots from rounding). */
export function clampBox(box: NormBox): NormBox {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  const w = Math.min(1 - x, Math.max(0, box.w));
  const h = Math.min(1 - y, Math.max(0, box.h));
  return { x, y, w, h };
}

export function boxCenter(box: NormBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

export function unionBoxes(boxes: readonly NormBox[]): NormBox {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Classify a box into a page region by its centre: header band / footer band / body,
 * and left / centre / right thirds.
 */
export function regionOf(box: NormBox, bands: BandConfig = DEFAULT_BANDS): PageRegion {
  const { x: cx, y: cy } = boxCenter(box);
  let vertical: 'top' | 'bottom' | null = null;
  if (cy <= bands.top) vertical = 'top';
  else if (cy >= 1 - bands.bottom) vertical = 'bottom';
  if (vertical === null) return 'body';
  const horizontal = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center';
  return `${vertical}-${horizontal}`;
}

export function isHeaderRegion(region: PageRegion): boolean {
  return region.startsWith('top-');
}

export function isFooterRegion(region: PageRegion): boolean {
  return region.startsWith('bottom-');
}

export function regionSide(region: PageRegion): 'left' | 'center' | 'right' | null {
  if (region === 'body') return null;
  return region.endsWith('-left') ? 'left' : region.endsWith('-right') ? 'right' : 'center';
}

export function regionBand(region: PageRegion): 'top' | 'bottom' | null {
  if (region === 'body') return null;
  return region.startsWith('top-') ? 'top' : 'bottom';
}
