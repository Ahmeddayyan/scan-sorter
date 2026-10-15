import type { BandConfig, PageRecord, PipelineError, PipelineProgress, SourceFile } from '../core';

export interface ProcessFilesCallbacks {
  /**
   * A file has been registered (before its pages are known). Called once per file, in
   * input order. `file` is the original File - the UI must keep it for export.
   */
  onSource: (source: SourceFile, file: File) => void;
  /**
   * Upsert of a page. Called at least twice per page: first with `status: 'pending'` and a
   * thumbnail (as soon as it is rendered), later with `status: 'done' | 'error'` once
   * evidence and candidates are final. The UI should replace the record by `id` each time
   * and re-run `inferDocument` after each call (debouncing is fine).
   */
  onPage: (page: PageRecord) => void;
  /** Coarse progress for the status bar. Called whenever counts or phase change. */
  onProgress: (progress: PipelineProgress) => void;
  /** Non-fatal problems (an unreadable file, a page that failed to render). */
  onError?: (error: PipelineError) => void;
}

export interface ProcessFilesOptions {
  /** Abort processing. Pages already emitted stay valid; `processFiles` resolves with `cancelled: true`. */
  signal?: AbortSignal;
  /**
   * 'auto' (default): use the PDF text layer when the page has one and it contains text in
   * the bands, OCR otherwise. 'always': OCR every page even if a text layer exists.
   * 'never': text layer only (fast; scanned pages come back unnumbered).
   */
  ocr?: 'auto' | 'always' | 'never';
  /** OCR the whole page when the bands produced no candidate. Default true. */
  fallbackFullPageOcr?: boolean;
  /** Band geometry. Default `DEFAULT_BANDS` from core. */
  bands?: BandConfig;
  /** Longest side of the thumbnail in CSS px. Default 240. */
  thumbnailSize?: number;
  /** Number of tesseract workers. Default `clamp(hardwareConcurrency - 1, 2, 4)`. */
  ocrWorkers?: number;
  /**
   * Where numbering of `inputIndex` / `SourceFile.inputIndex` continues when files are added
   * to an existing session. Default 0 / 0.
   */
  startInputIndex?: number;
  startSourceIndex?: number;
}

export interface ProcessFilesResult {
  sources: SourceFile[];
  pages: PageRecord[];
  errors: PipelineError[];
  cancelled: boolean;
}

export type ReanalyzeCallbacks = Pick<ProcessFilesCallbacks, 'onPage' | 'onProgress' | 'onError'>;
export type ReanalyzeOptions = Pick<ProcessFilesOptions, 'signal' | 'bands' | 'fallbackFullPageOcr'>;
