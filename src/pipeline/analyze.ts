/**
 * Per-page analysis: text layer first, band OCR when needed, optional full-page fallback.
 * Works on the {@link PageSource} abstraction, so PDFs and images share the code.
 */
import { bandRects, extractCandidates } from '../core';
import type { BandConfig, BandId, PageEvidence, PageNumberCandidate, PixelRect } from '../core';
import { canvasToOcrPng, releaseCanvas } from './canvas';
import { fullPageScale, imageBandScale, ocrBlocksToItems, pdfBandScale } from './helpers';
import type { OcrBlockLike } from './helpers';
import type { PageSource } from './source';

export interface AnalysisSettings {
  ocr: 'auto' | 'always' | 'never';
  fallbackFullPageOcr: boolean;
  bands: BandConfig;
}

export interface Analysis {
  evidence: PageEvidence;
  candidates: PageNumberCandidate[];
}

export interface BandCrop {
  band: BandId;
  /** Region on the page, in page units. */
  rect: PixelRect;
  /** Preprocessed PNG handed to tesseract. */
  blob: Blob;
  /** Pixel size of that PNG. */
  cropWidth: number;
  cropHeight: number;
}

export type Prepared =
  | ({ kind: 'final' } & Analysis)
  | {
      kind: 'ocr';
      crops: BandCrop[];
      /** The text-layer analysis, used when OCR finds nothing better (or fails). */
      textFallback: Analysis | null;
      hasTextLayer: boolean;
    };

export type Recognize = (image: Blob) => Promise<readonly OcrBlockLike[]>;

/** A candidate outside the body region: the only kind we trust a text layer for. */
export function hasUsableCandidate(candidates: readonly PageNumberCandidate[]): boolean {
  return candidates.some((c) => c.region !== 'body');
}

function analyse(evidence: PageEvidence, bands: BandConfig): Analysis {
  return { evidence, candidates: extractCandidates(evidence, { bands }).candidates };
}

export const EMPTY_ANALYSIS: Analysis = {
  evidence: { source: 'none', bands: ['full'], items: [], hasTextLayer: false },
  candidates: [],
};

/** Render the header/footer band crops (the only pixels OCR ever sees in the normal path). */
export async function renderBandCrops(src: PageSource, bands: BandConfig): Promise<BandCrop[]> {
  const rects = bandRects(src.width, src.height, bands);
  const scale = src.kind === 'pdf-page' ? pdfBandScale(src.width) : imageBandScale(src.width);
  const crops: BandCrop[] = [];
  for (const band of ['top', 'bottom'] as const) {
    const canvas = await src.renderRegion(rects[band], scale);
    try {
      const cropWidth = canvas.width;
      const cropHeight = canvas.height;
      crops.push({ band, rect: rects[band], blob: await canvasToOcrPng(canvas), cropWidth, cropHeight });
    } finally {
      releaseCanvas(canvas);
    }
  }
  return crops;
}

/**
 * Step 1 (render lane): read the text layer; if it already yields a header/footer number we
 * are done, otherwise render the band crops for OCR.
 */
export async function prepareAnalysis(src: PageSource, settings: AnalysisSettings): Promise<Prepared> {
  let textFallback: Analysis | null = null;
  let hasTextLayer = false;
  if (src.readTextLayer) {
    let items: PageEvidence['items'] = [];
    try {
      items = await src.readTextLayer();
    } catch {
      items = [];
    }
    hasTextLayer = items.length > 0;
    textFallback = analyse(
      { source: hasTextLayer ? 'text-layer' : 'none', bands: ['full'], items, hasTextLayer },
      settings.bands,
    );
    if (settings.ocr !== 'always' && (settings.ocr === 'never' || hasUsableCandidate(textFallback.candidates))) {
      return { kind: 'final', ...textFallback };
    }
  }
  if (settings.ocr === 'never') return { kind: 'final', ...EMPTY_ANALYSIS };
  const crops = await renderBandCrops(src, settings.bands);
  src.trim();
  return { kind: 'ocr', crops, textFallback, hasTextLayer };
}

/**
 * Step 2 (OCR consumer): recognise the prepared crops, fall back to the whole page when the
 * bands gave nothing, and pick the best evidence.
 */
export async function runOcr(
  src: PageSource,
  prepared: Extract<Prepared, { kind: 'ocr' }>,
  settings: AnalysisSettings,
  recognize: Recognize,
  isCancelled: () => boolean = () => false,
): Promise<Analysis> {
  const page = { width: src.width, height: src.height };
  const bandItems = await Promise.all(
    prepared.crops.map(async (crop) =>
      ocrBlocksToItems(await recognize(crop.blob), crop.rect, page, { width: crop.cropWidth, height: crop.cropHeight }),
    ),
  );
  let ocr = analyse(
    { source: 'ocr', bands: ['top', 'bottom'], items: bandItems.flat(), hasTextLayer: prepared.hasTextLayer },
    settings.bands,
  );

  if (ocr.candidates.length === 0 && settings.fallbackFullPageOcr && !isCancelled()) {
    const full: PixelRect = { x: 0, y: 0, width: src.width, height: src.height };
    const canvas = await src.renderRegion(full, fullPageScale(src.width, src.height, src.kind));
    try {
      const cropWidth = canvas.width;
      const cropHeight = canvas.height;
      const blob = await canvasToOcrPng(canvas);
      releaseCanvas(canvas);
      const items = ocrBlocksToItems(await recognize(blob), full, page, { width: cropWidth, height: cropHeight });
      ocr = analyse({ source: 'ocr', bands: ['full'], items, hasTextLayer: prepared.hasTextLayer }, settings.bands);
    } finally {
      releaseCanvas(canvas);
      src.trim();
    }
  }
  return pickBest(ocr, prepared.textFallback);
}

/** OCR wins when it found a number; otherwise keep a non-empty text layer; else the OCR result. */
export function pickBest(ocr: Analysis, text: Analysis | null): Analysis {
  if (ocr.candidates.length > 0) return ocr;
  if (text && text.evidence.items.length > 0) return text;
  return ocr;
}
