/**
 * Browser pipeline - OWNED BY THE PIPELINE AGENT.
 *
 *   - open PDFs with pdf.js and decode images (JPG/PNG/WebP);
 *   - render a small thumbnail per page (object URL) and compute a 64-bit dHash;
 *   - get positioned words: PDF text layer when present, otherwise tesseract.js OCR of the
 *     header/footer bands (and optionally the full page as a fallback);
 *   - call `extractCandidates()` from core and emit a complete PageRecord;
 *   - run OCR through a tesseract scheduler with 2-4 workers, self-hosted assets;
 *   - support cancellation and keep memory bounded (no full-page bitmaps retained).
 *
 * The implementation lives in sibling modules; this file keeps the contracted public API:
 * `processFiles`, `reanalyzePages`, `renderPagePreview`, `releasePages`, `shutdownPipeline`
 * plus the option/callback types. See docs/ARCHITECTURE.md section 5.
 */
export type {
  ProcessFilesCallbacks,
  ProcessFilesOptions,
  ProcessFilesResult,
} from './types';
export { processFiles, reanalyzePages, releasePages, renderPagePreview, shutdownPipeline } from './process';
