/**
 * The pipeline orchestrator: processFiles / reanalyzePages / renderPagePreview / releasePages /
 * shutdownPipeline.
 *
 * Concurrency design
 *   render lane (1 page at a time, all files in order)
 *        thumbnail + dHash  ->  emit 'pending'  ->  text layer
 *        text layer has a header/footer number?  yes -> emit 'done'
 *                                                 no  -> render band crops (small PNGs) ->
 *   bounded queue (capacity = 2 x workers)  <- back-pressure keeps the lane a few pages ahead
 *        OCR consumers (= number of tesseract workers) -> scheduler -> emit 'done'
 * Full-page bitmaps never outlive the render call that produced them; only thumbnails (JPEG
 * object URLs) and the queued band PNGs are retained.
 */
import { DEFAULT_BANDS } from '../core';
import type {
  PageId,
  PageRecord,
  PipelineError,
  PipelineProgress,
  Rotation,
  SourceFile,
} from '../core';
import { prepareAnalysis, runOcr } from './analyze';
import type { Analysis, AnalysisSettings, Prepared } from './analyze';
import { canvasToBlob, perceptualHashOf, releaseCanvas } from './canvas';
import { BoundedQueue, detectFileKind, errorMessage, isAbortError, resolveWorkerCount } from './helpers';
import { ImagePageSource, renderImagePreview } from './image';
import { addOcrListener, getScheduler, recognizeBlob, terminateScheduler } from './ocr';
import { PdfPageSource, openPdf, renderPdfPreview } from './pdf';
import {
  forgetAll,
  forgetPages,
  getCachedDocument,
  getPageEntry,
  getSourceEntry,
  nextSourceId,
  pageIdFor,
  registerSource,
  rememberPage,
} from './registry';
import type { PageSource } from './source';
import type {
  ProcessFilesCallbacks,
  ProcessFilesOptions,
  ProcessFilesResult,
  ReanalyzeCallbacks,
  ReanalyzeOptions,
} from './types';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const DEFAULT_THUMBNAIL_SIZE = 240;
const THUMBNAIL_QUALITY = 0.8;

interface OcrTask {
  run: () => Promise<void>;
  /** Called instead of `run` when the task is dropped (cancel). */
  discard: () => void;
}

interface PageIdent {
  id: PageId;
  sourceFileId: string;
  sourceIndex: number;
  inputIndex: number;
  kind: PageRecord['kind'];
  label: string;
}

/** Keeps a pdf.js document alive until the render lane and all its queued OCR tasks are done. */
class DocHolder {
  pending = 0;
  laneDone = false;
  private destroyed = false;
  private readonly doc: PDFDocumentProxy;

  constructor(doc: PDFDocumentProxy) {
    this.doc = doc;
  }

  release(): void {
    if (this.laneDone && this.pending === 0 && !this.destroyed) {
      this.destroyed = true;
      void this.doc.loadingTask.destroy().catch(() => undefined);
    }
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.error('[scan-sorter] callback threw', error);
  }
}

/** Resolves with 'aborted' once `signal` aborts (immediately if it already has); never otherwise. */
function abortPromise(signal: AbortSignal | undefined): Promise<'aborted'> {
  return new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve('aborted');
    else signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });
}

function cancelledError(): DOMException {
  return new DOMException('Cancelled', 'AbortError');
}

function emptyEvidence(): PageRecord['evidence'] {
  return { source: 'none', bands: ['full'], items: [], hasTextLayer: false };
}

function hardwareThreads(): number | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency;
}

// ---------------------------------------------------------------------------
// processFiles
// ---------------------------------------------------------------------------

export async function processFiles(
  files: readonly File[],
  callbacks: ProcessFilesCallbacks,
  options: ProcessFilesOptions = {},
): Promise<ProcessFilesResult> {
  const signal = options.signal;
  const settings: AnalysisSettings = {
    ocr: options.ocr ?? 'auto',
    fallbackFullPageOcr: options.fallbackFullPageOcr ?? true,
    bands: options.bands ?? DEFAULT_BANDS,
  };
  const thumbnailSize = options.thumbnailSize ?? DEFAULT_THUMBNAIL_SIZE;
  const aborted = (): boolean => signal?.aborted === true;
  /** Settles on abort; used to stop waiting for OCR jobs that a terminated worker never answers. */
  const abortSignal = abortPromise(signal);

  let nextInputIndex = options.startInputIndex ?? 0;
  let nextSourceIndex = options.startSourceIndex ?? 0;

  const sources: SourceFile[] = [];
  const pageMap = new Map<PageId, PageRecord>();
  const errors: PipelineError[] = [];
  const progress: PipelineProgress = {
    phase: 'loading',
    totalPages: null,
    renderedPages: 0,
    analyzedPages: 0,
    ocrPages: 0,
    currentFile: null,
    message: null,
  };
  const report = (): void => safe(() => callbacks.onProgress({ ...progress }));
  const reportError = (error: PipelineError): void => {
    errors.push(error);
    safe(() => callbacks.onError?.(error));
  };
  const emit = (record: PageRecord): void => {
    pageMap.set(record.id, record);
    rememberPage(record);
    safe(() => callbacks.onPage(record));
  };

  // ---- OCR consumers (lazy) ------------------------------------------------
  const qState: { queue: BoundedQueue<OcrTask> | null } = { queue: null };
  let startup: Promise<void> | null = null;
  const consumers: Promise<void>[] = [];
  let ocrInitError: string | null = null;

  const removeListener = addOcrListener({
    onStatus: (message) => {
      progress.message = message;
      report();
    },
    onError: (message) => reportError({ sourceFileId: null, fileName: null, pageId: null, message }),
  });

  const consume = async (q: BoundedQueue<OcrTask>): Promise<void> => {
    for (;;) {
      const task = await q.pull();
      if (!task) return;
      if (aborted()) {
        task.discard();
        continue;
      }
      try {
        const outcome = await Promise.race([task.run().then(() => 'ok' as const), abortSignal]);
        if (outcome === 'aborted') task.discard();
      } catch (error) {
        console.error('[scan-sorter] OCR task failed', error);
      }
    }
  };

  const ensureQueue = (): BoundedQueue<OcrTask> => {
    if (qState.queue) return qState.queue;
    const q = new BoundedQueue<OcrTask>(resolveWorkerCount(options.ocrWorkers, hardwareThreads()) * 2);
    qState.queue = q;
    progress.message = 'Loading OCR engine…';
    report();
    startup = getScheduler(options.ocrWorkers)
      .then(
        ({ workers }) => workers,
        (error: unknown) => {
          ocrInitError = errorMessage(error, 'OCR engine failed to load');
          reportError({
            sourceFileId: null,
            fileName: null,
            pageId: null,
            message: `OCR engine failed to load: ${ocrInitError}`,
          });
          return 1;
        },
      )
      .then((workers) => {
        for (let i = 0; i < workers; i += 1) consumers.push(consume(q));
      });
    return q;
  };

  const recognize = (image: Blob): ReturnType<typeof recognizeBlob> => {
    if (aborted()) return Promise.reject(cancelledError());
    if (ocrInitError) return Promise.reject(new Error(`OCR engine unavailable: ${ocrInitError}`));
    return recognizeBlob(image);
  };

  const onAbort = (): void => {
    if (qState.queue) {
      qState.queue.close();
      for (const task of qState.queue.drain()) task.discard();
    }
    void terminateScheduler();
  };
  signal?.addEventListener('abort', onAbort);

  // ---- page finalisation ---------------------------------------------------
  const finalize = (pending: PageRecord, analysis: Analysis): void => {
    progress.analyzedPages += 1;
    emit({ ...pending, evidence: analysis.evidence, candidates: analysis.candidates, status: 'done' });
    report();
  };
  const finalizeError = (pending: PageRecord, message: string): void => {
    progress.analyzedPages += 1;
    emit({ ...pending, evidence: emptyEvidence(), candidates: [], status: 'error', error: message });
    reportError({ sourceFileId: pending.sourceFileId, fileName: pending.label, pageId: pending.id, message });
    report();
  };

  /** Thumbnail + hash + 'pending' emission + text layer / OCR hand-off for one page. */
  const handlePage = async (src: PageSource, ident: PageIdent, holder: DocHolder | null): Promise<void> => {
    let finished = false;
    let handedOff = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      src.dispose();
      if (holder) {
        holder.pending -= 1;
        holder.release();
      }
    };
    if (holder) holder.pending += 1;
    try {
      if (aborted()) return;
      let thumbnail: PageRecord['thumbnail'] = null;
      let hash: string | null = null;
      try {
        const canvas = await src.renderThumbnail(thumbnailSize);
        try {
          const width = canvas.width;
          const height = canvas.height;
          hash = perceptualHashOf(canvas);
          const blob = await canvasToBlob(canvas, 'image/jpeg', THUMBNAIL_QUALITY);
          thumbnail = { url: URL.createObjectURL(blob), width, height };
        } finally {
          releaseCanvas(canvas);
        }
      } catch (error) {
        reportError({
          sourceFileId: ident.sourceFileId,
          fileName: ident.label,
          pageId: ident.id,
          message: `Could not render a preview: ${errorMessage(error)}`,
        });
      }
      if (aborted()) {
        if (thumbnail) URL.revokeObjectURL(thumbnail.url);
        return;
      }
      const pending: PageRecord = {
        ...ident,
        width: src.width,
        height: src.height,
        thumbnail,
        perceptualHash: hash,
        evidence: emptyEvidence(),
        candidates: [],
        status: 'pending',
      };
      emit(pending);
      if (thumbnail) progress.renderedPages += 1;
      report();

      let prepared: Prepared;
      try {
        prepared = await prepareAnalysis(src, settings);
      } catch (error) {
        if (!aborted()) finalizeError(pending, `Could not analyse the page: ${errorMessage(error)}`);
        return;
      }
      if (aborted()) return;
      if (prepared.kind === 'final') {
        finalize(pending, prepared);
        return;
      }

      const ocrPrepared = prepared;
      const task: OcrTask = {
        discard: finish,
        run: async () => {
          try {
            const analysis = await runOcr(src, ocrPrepared, settings, recognize, aborted);
            if (aborted()) return;
            progress.ocrPages += 1;
            finalize(pending, analysis);
          } catch (error) {
            if (aborted() || isAbortError(error)) return;
            const message = errorMessage(error, 'OCR failed');
            if (ocrPrepared.textFallback && ocrPrepared.textFallback.evidence.items.length > 0) {
              reportError({ sourceFileId: ident.sourceFileId, fileName: ident.label, pageId: ident.id, message });
              finalize(pending, ocrPrepared.textFallback);
            } else {
              finalizeError(pending, message);
            }
          } finally {
            finish();
          }
        },
      };
      const q = ensureQueue();
      const queued = await q.push(task);
      if (queued) handedOff = true; // the task now owns disposal (it calls finish() itself)
      else task.discard();
    } finally {
      if (!handedOff) finish();
    }
  };

  // ---- main loop -------------------------------------------------------------
  const accepted = files
    .map((file) => ({ file, detected: detectFileKind(file.name, file.type) }))
    .filter((entry) => {
      if (entry.detected) return true;
      reportError({
        sourceFileId: null,
        fileName: entry.file.name,
        pageId: null,
        message: `"${entry.file.name}" is not a supported file. Use a PDF or a JPG, PNG or WebP image.`,
      });
      return false;
    });

  let totalSoFar = 0;
  const finishCounting = (index: number): void => {
    if (index === accepted.length - 1) progress.totalPages = totalSoFar;
  };
  if (accepted.length === 0) progress.totalPages = 0;
  report();

  try {
    for (let fi = 0; fi < accepted.length; fi += 1) {
      if (aborted()) break;
      const { file, detected } = accepted[fi];
      if (!detected) continue;
      progress.phase = 'loading';
      progress.currentFile = file.name;
      progress.message = `Opening ${file.name}…`;
      report();

      const sourceId = nextSourceId();
      const base: Omit<SourceFile, 'pageCount'> = {
        id: sourceId,
        name: file.name,
        kind: detected.kind,
        mimeType: detected.mimeType,
        size: file.size,
        inputIndex: nextSourceIndex,
      };

      if (detected.kind === 'pdf') {
        let doc: PDFDocumentProxy;
        try {
          doc = await openPdf(file);
        } catch (error) {
          if (aborted()) break;
          reportError({
            sourceFileId: null,
            fileName: file.name,
            pageId: null,
            message: `Could not open "${file.name}": ${errorMessage(error, 'not a readable PDF')}`,
          });
          finishCounting(fi);
          report();
          continue;
        }
        const holder = new DocHolder(doc);
        const pageCount = doc.numPages;
        const source: SourceFile = { ...base, pageCount };
        nextSourceIndex += 1;
        registerSource(sourceId, file, 'pdf');
        sources.push(source);
        safe(() => callbacks.onSource(source, file));
        totalSoFar += pageCount;
        finishCounting(fi);
        progress.phase = 'analyzing';
        progress.message = null;
        report();

        for (let p = 0; p < pageCount; p += 1) {
          if (aborted()) break;
          const ident: PageIdent = {
            id: pageIdFor(sourceId, p),
            sourceFileId: sourceId,
            sourceIndex: p,
            inputIndex: nextInputIndex,
            kind: 'pdf-page',
            label: `${file.name} · p.${p + 1}`,
          };
          nextInputIndex += 1;
          let src: PdfPageSource;
          try {
            src = await PdfPageSource.open(doc, p);
          } catch (error) {
            const message = `Could not read page ${p + 1}: ${errorMessage(error)}`;
            const failed: PageRecord = {
              ...ident,
              width: 612,
              height: 792,
              thumbnail: null,
              perceptualHash: null,
              evidence: emptyEvidence(),
              candidates: [],
              status: 'pending',
            };
            emit(failed);
            finalizeError(failed, message);
            continue;
          }
          await handlePage(src, ident, holder);
        }
        holder.laneDone = true;
        holder.release();
      } else {
        const pageCount = 1;
        const source: SourceFile = { ...base, pageCount };
        nextSourceIndex += 1;
        registerSource(sourceId, file, 'image');
        sources.push(source);
        safe(() => callbacks.onSource(source, file));
        totalSoFar += pageCount;
        finishCounting(fi);
        progress.phase = 'analyzing';
        progress.message = null;
        report();

        const ident: PageIdent = {
          id: pageIdFor(sourceId, 0),
          sourceFileId: sourceId,
          sourceIndex: 0,
          inputIndex: nextInputIndex,
          kind: 'image',
          label: file.name,
        };
        nextInputIndex += 1;
        let src: ImagePageSource;
        try {
          src = await ImagePageSource.open(file);
        } catch (error) {
          const failed: PageRecord = {
            ...ident,
            width: 595,
            height: 842,
            thumbnail: null,
            perceptualHash: null,
            evidence: emptyEvidence(),
            candidates: [],
            status: 'pending',
          };
          emit(failed);
          finalizeError(failed, `Could not decode the image: ${errorMessage(error, 'unsupported or corrupt image')}`);
          continue;
        }
        await handlePage(src, ident, null);
      }
    }
  } finally {
    // Let the OCR side drain (or discard, when cancelled), whatever happened in the lane.
    qState.queue?.close();
    if (startup) await Promise.race([startup, abortSignal]);
    await Promise.all(consumers);
    if (aborted() && qState.queue) for (const task of qState.queue.drain()) task.discard();
    signal?.removeEventListener('abort', onAbort);
    removeListener();
  }

  const cancelled = aborted();
  if (cancelled) {
    await terminateScheduler();
    progress.phase = 'cancelled';
  } else {
    progress.phase = pageMap.size === 0 && errors.length > 0 ? 'error' : 'done';
  }
  progress.message = null;
  progress.currentFile = null;
  report();

  return { sources, pages: [...pageMap.values()], errors, cancelled };
}

// ---------------------------------------------------------------------------
// reanalyzePages
// ---------------------------------------------------------------------------

export async function reanalyzePages(
  pageIds: readonly PageId[],
  callbacks: ReanalyzeCallbacks,
  options: ReanalyzeOptions = {},
): Promise<PageRecord[]> {
  const signal = options.signal;
  const aborted = (): boolean => signal?.aborted === true;
  const abortSignal = abortPromise(signal);
  const settings: AnalysisSettings = {
    ocr: 'always',
    fallbackFullPageOcr: options.fallbackFullPageOcr ?? true,
    bands: options.bands ?? DEFAULT_BANDS,
  };
  const progress: PipelineProgress = {
    phase: 'analyzing',
    totalPages: pageIds.length,
    renderedPages: pageIds.length,
    analyzedPages: 0,
    ocrPages: 0,
    currentFile: null,
    message: null,
  };
  const report = (): void => safe(() => callbacks.onProgress({ ...progress }));
  const reportError = (error: PipelineError): void => safe(() => callbacks.onError?.(error));
  const removeListener = addOcrListener({
    onStatus: (message) => {
      progress.message = message;
      report();
    },
  });
  const onAbort = (): void => void terminateScheduler();
  signal?.addEventListener('abort', onAbort);
  report();

  const out: PageRecord[] = [];
  try {
    await Promise.race([getScheduler(), abortSignal]);
    for (const id of pageIds) {
      if (aborted()) break;
      const entry = getPageEntry(id);
      const sourceEntry = entry ? getSourceEntry(entry.sourceId) : undefined;
      if (!entry || !sourceEntry) {
        reportError({ sourceFileId: entry?.sourceId ?? null, fileName: null, pageId: id, message: 'Page is no longer available.' });
        continue;
      }
      progress.currentFile = entry.record.label;
      report();
      let src: PageSource | null = null;
      try {
        src =
          entry.kind === 'pdf-page'
            ? await PdfPageSource.open(await getCachedDocument(entry.sourceId), entry.sourceIndex)
            : await ImagePageSource.open(sourceEntry.file);
        const prepared = await prepareAnalysis(src, settings);
        const analysis =
          prepared.kind === 'final'
            ? prepared
            : await Promise.race([
                runOcr(src, prepared, settings, (blob) => (aborted() ? Promise.reject(cancelledError()) : recognizeBlob(blob)), aborted),
                abortSignal.then(() => null),
              ]);
        if (aborted() || analysis === null) break;
        progress.ocrPages += 1;
        const record: PageRecord = {
          ...entry.record,
          evidence: analysis.evidence,
          candidates: analysis.candidates,
          status: 'done',
        };
        delete record.error;
        rememberPage(record);
        out.push(record);
        safe(() => callbacks.onPage(record));
      } catch (error) {
        if (aborted() || isAbortError(error)) break;
        reportError({
          sourceFileId: entry.sourceId,
          fileName: entry.record.label,
          pageId: id,
          message: `Re-analysis failed: ${errorMessage(error)}`,
        });
      } finally {
        src?.dispose();
      }
      progress.analyzedPages += 1;
      report();
    }
  } catch (error) {
    if (!aborted()) {
      reportError({
        sourceFileId: null,
        fileName: null,
        pageId: null,
        message: `OCR engine failed to load: ${errorMessage(error)}`,
      });
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    removeListener();
  }
  if (aborted()) await terminateScheduler();
  progress.phase = aborted() ? 'cancelled' : 'done';
  progress.message = null;
  progress.currentFile = null;
  report();
  return out;
}

// ---------------------------------------------------------------------------
// previews, release, shutdown
// ---------------------------------------------------------------------------

export async function renderPagePreview(pageId: PageId, maxSize: number, rotation: Rotation = 0): Promise<string> {
  const entry = getPageEntry(pageId);
  const sourceEntry = entry ? getSourceEntry(entry.sourceId) : undefined;
  if (!entry || !sourceEntry) throw new Error('Page is no longer available.');
  const canvas =
    entry.kind === 'pdf-page'
      ? await renderPdfPreview(await getCachedDocument(entry.sourceId), entry.sourceIndex, maxSize, rotation)
      : await renderImagePreview(sourceEntry.file, maxSize, rotation);
  try {
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    return URL.createObjectURL(blob);
  } finally {
    releaseCanvas(canvas);
  }
}

export function releasePages(pageIds: readonly PageId[]): void {
  forgetPages(pageIds);
}

export async function shutdownPipeline(): Promise<void> {
  forgetAll();
  await terminateScheduler();
}
