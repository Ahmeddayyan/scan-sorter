/**
 * Export - OWNED BY THE PIPELINE AGENT (implemented with pdf-lib, loaded lazily).
 *
 * Builds the sorted PDF from an `ExportPlan` (from core `buildExportPlan`):
 *   - pages whose source is a PDF are copied losslessly with `PDFDocument.copyPages`
 *     (consecutive pages of one source go through a single call);
 *   - image pages are embedded - JPEG/PNG bytes directly when that is faithful, otherwise
 *     (WebP, JPEG with an EXIF orientation, PNGs pdf-lib cannot parse) re-encoded through a
 *     canvas (JPEG q=0.92 on white, or PNG for unparsable PNGs). The page is the image fitted
 *     to an A4 sheet in the image's own orientation, aspect ratio preserved (see
 *     `fitImageToPage`), so photos print at a sensible size;
 *   - the plan's `rotation` is added on top of the page's intrinsic /Rotate;
 *   - optional bookmarks ("Page 17", "Page iv") for every numbered page;
 *   - encrypted source PDFs are rejected with a clear message (pdf-lib cannot decrypt them,
 *     and copying their still-encrypted streams would produce a broken file);
 *   - everything runs in the browser; nothing is uploaded.
 */
import type { ExportPage, ExportPlan, SourceFileId } from '../core';
import { formatPageNumber } from '../core';
import { canvasToBlob, createCanvas, fillWhite, getContext, releaseCanvas } from '../pipeline/canvas';
import { combineRotation, fitImageToPage, groupRuns, normalizeFileName, readJpegOrientation, sniffImageType } from './helpers';
import type { PDFDocument, PDFImage } from 'pdf-lib';

export interface ExportRequest {
  plan: ExportPlan;
  /** Original bytes per source file id (the `File` objects handed over by `onSource`). */
  sources: ReadonlyMap<SourceFileId, Blob>;
  /** Override `plan.fileName`. */
  fileName?: string;
  /** Called after each page is added (done, total). */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Embed the final page numbers as outline/bookmark entries. Default false. */
  addBookmarks?: boolean;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  pageCount: number;
  /** Milliseconds spent. */
  durationMs: number;
}

type PdfLib = typeof import('pdf-lib');

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

function describeSource(blob: Blob, id: string): string {
  const name = (blob as Partial<File>).name;
  return name ? `"${name}"` : `source ${id}`;
}

/** Decode an image blob (EXIF applied) and re-encode it through a canvas. */
async function reencode(blob: Blob, type: 'image/jpeg' | 'image/png'): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const canvas = createCanvas(bitmap.width, bitmap.height);
  try {
    const ctx = getContext(canvas);
    fillWhite(canvas, ctx);
    ctx.drawImage(bitmap, 0, 0);
    const out = await canvasToBlob(canvas, type, type === 'image/jpeg' ? 0.92 : undefined);
    return new Uint8Array(await out.arrayBuffer());
  } finally {
    bitmap.close();
    releaseCanvas(canvas);
  }
}

async function embedImage(out: PDFDocument, blob: Blob): Promise<PDFImage> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = sniffImageType(bytes) ?? (blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpeg' : null);
  if (type === 'jpeg' && readJpegOrientation(bytes) === 1) {
    try {
      return await out.embedJpg(bytes);
    } catch {
      /* e.g. progressive / unusual JPEG: fall through to re-encoding */
    }
  } else if (type === 'png') {
    try {
      return await out.embedPng(bytes);
    } catch {
      return out.embedPng(await reencode(blob, 'image/png'));
    }
  }
  // WebP, JPEG with EXIF orientation, or anything pdf-lib rejected.
  return out.embedJpg(await reencode(blob, 'image/jpeg'));
}

function bookmarkTitle(page: ExportPage): string | null {
  return page.number ? `Page ${formatPageNumber(page.number)}` : null;
}

function addOutline(lib: PdfLib, out: PDFDocument, pages: readonly ExportPage[]): void {
  const entries: { title: string; index: number }[] = [];
  pages.forEach((page, index) => {
    const title = bookmarkTitle(page);
    if (title) entries.push({ title, index });
  });
  if (entries.length === 0) return;
  const { PDFHexString, PDFName } = lib;
  const ctx = out.context;
  const outPages = out.getPages();
  const rootRef = ctx.nextRef();
  const refs = entries.map(() => ctx.nextRef());
  entries.forEach((entry, i) => {
    const fields: Record<string, unknown> = {
      Title: PDFHexString.fromText(entry.title),
      Parent: rootRef,
      Dest: [outPages[entry.index].ref, PDFName.of('Fit')],
    };
    if (i > 0) fields.Prev = refs[i - 1];
    if (i < entries.length - 1) fields.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(fields as Parameters<typeof ctx.obj>[0]));
  });
  ctx.assign(
    rootRef,
    ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: entries.length }),
  );
  out.catalog.set(PDFName.of('Outlines'), rootRef);
  out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Build the sorted PDF. Rejects with `DOMException` name "AbortError" when cancelled. */
export async function exportSortedPdf(request: ExportRequest): Promise<ExportResult> {
  const started = performance.now();
  const { plan, sources, signal, onProgress } = request;
  const total = plan.pages.length;
  if (total === 0) throw new Error('There are no pages to export.');
  checkAbort(signal);

  const lib = await import('pdf-lib');
  const { PDFDocument: PDFDocumentClass, degrees } = lib;
  const out = await PDFDocumentClass.create();
  const loaded = new Map<SourceFileId, PDFDocument>();

  const loadSource = async (id: SourceFileId): Promise<PDFDocument> => {
    const cached = loaded.get(id);
    if (cached) return cached;
    const blob = sources.get(id);
    if (!blob) throw new Error(`The original file for source ${id} is missing, so it cannot be exported.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try {
      const doc = await PDFDocumentClass.load(bytes);
      loaded.set(id, doc);
      return doc;
    } catch (error) {
      const name = describeSource(blob, id);
      if (error instanceof lib.EncryptedPDFError) {
        throw new Error(`${name} is password-protected or encrypted. Remove the protection first, then try again.`);
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${name} could not be read as a PDF (${reason}).`);
    }
  };

  let done = 0;
  const tick = (): void => {
    done += 1;
    onProgress?.(done, total);
  };

  for (const run of groupRuns(plan.pages)) {
    checkAbort(signal);
    if (run.kind === 'pdf') {
      const src = await loadSource(run.sourceFileId);
      const count = src.getPageCount();
      for (const page of run.pages) {
        if (page.sourceIndex < 0 || page.sourceIndex >= count) {
          throw new Error(
            `Page ${page.sourceIndex + 1} does not exist in ${describeSource(sources.get(run.sourceFileId) as Blob, run.sourceFileId)} (it has ${count}).`,
          );
        }
      }
      const copied = await out.copyPages(
        src,
        run.pages.map((p) => p.sourceIndex),
      );
      for (let i = 0; i < copied.length; i += 1) {
        checkAbort(signal);
        const page = out.addPage(copied[i]);
        const extra = run.pages[i].rotation;
        if (extra !== 0) page.setRotation(degrees(combineRotation(page.getRotation().angle, extra)));
        tick();
      }
    } else {
      const blob = sources.get(run.sourceFileId);
      if (!blob) throw new Error(`The original image for source ${run.sourceFileId} is missing, so it cannot be exported.`);
      for (const planned of run.pages) {
        checkAbort(signal);
        const image = await embedImage(out, blob);
        const size = fitImageToPage(image.width, image.height);
        const page = out.addPage([size.width, size.height]);
        page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
        if (planned.rotation !== 0) page.setRotation(degrees(planned.rotation));
        tick();
      }
    }
  }

  checkAbort(signal);
  const fileName = normalizeFileName(request.fileName, plan.fileName);
  out.setTitle(fileName.replace(/\.pdf$/i, ''));
  out.setProducer('Scan Sorter');
  out.setCreator('Scan Sorter');
  if (request.addBookmarks) addOutline(lib, out, plan.pages);

  const bytes = await out.save();
  checkAbort(signal);
  return {
    blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
    fileName,
    pageCount: total,
    durationMs: Math.round(performance.now() - started),
  };
}

/** Trigger a browser download of an export result (creates and revokes an object URL). */
export function downloadExport(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke later: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
