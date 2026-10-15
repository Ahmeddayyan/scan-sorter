import type { PageKind, PixelRect, TextItem } from '../core';
import type { AnyCanvas } from './canvas';

/**
 * Abstraction over "one page we can render": a pdf.js page or a decoded image. All
 * coordinates are in the page's natural upright units (PDF points after /Rotate, or image
 * pixels), origin top-left, so the same band geometry works for both.
 */
export interface PageSource {
  readonly kind: PageKind;
  readonly width: number;
  readonly height: number;
  /** PDF text layer as normalised items; absent for images. */
  readTextLayer?(): Promise<TextItem[]>;
  /** Render the whole page with its longest side `maxSize` px. The caller releases the canvas. */
  renderThumbnail(maxSize: number): Promise<AnyCanvas>;
  /** Render `rect` (page units) at `scale` px per unit onto a white canvas. The caller releases it. */
  renderRegion(rect: PixelRect, scale: number): Promise<AnyCanvas>;
  /** Drop heavy resources (decoded bitmap, pdf.js page caches); the source stays usable. */
  trim(): void;
  /** Final cleanup. */
  dispose(): void;
}
