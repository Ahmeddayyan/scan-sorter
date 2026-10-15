/**
 * Module-level bookkeeping: which File belongs to which source, the latest PageRecord per
 * page (for previews / re-analysis) and a tiny LRU of open pdf.js documents for previews.
 * Ids are unique for the tab lifetime (counters are never reset).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageId, PageKind, PageRecord, SourceFileId, SourceFileKind } from '../core';
import { openPdf } from './pdf';

let sourceCounter = 0;

export function nextSourceId(): SourceFileId {
  sourceCounter += 1;
  return `s${sourceCounter}`;
}

export function pageIdFor(sourceId: SourceFileId, sourceIndex: number): PageId {
  return `${sourceId}-p${sourceIndex + 1}`;
}

interface SourceEntry {
  file: File;
  kind: SourceFileKind;
}

export interface PageEntry {
  sourceId: SourceFileId;
  sourceIndex: number;
  kind: PageKind;
  record: PageRecord;
}

const sources = new Map<SourceFileId, SourceEntry>();
const pages = new Map<PageId, PageEntry>();

export function registerSource(id: SourceFileId, file: File, kind: SourceFileKind): void {
  sources.set(id, { file, kind });
}

export function getSourceEntry(id: SourceFileId): SourceEntry | undefined {
  return sources.get(id);
}

export function rememberPage(record: PageRecord): void {
  pages.set(record.id, {
    sourceId: record.sourceFileId,
    sourceIndex: record.sourceIndex,
    kind: record.kind,
    record,
  });
}

export function getPageEntry(id: PageId): PageEntry | undefined {
  return pages.get(id);
}

// ---------------------------------------------------------------------------
// Document cache for previews / re-analysis
// ---------------------------------------------------------------------------

const MAX_OPEN_DOCS = 2;
/** Insertion-ordered: the first key is the least recently used. */
const docs = new Map<SourceFileId, Promise<PDFDocumentProxy>>();

function destroyDoc(promise: Promise<PDFDocumentProxy>): void {
  void promise.then((doc) => doc.loadingTask.destroy()).catch(() => undefined);
}

export function getCachedDocument(sourceId: SourceFileId): Promise<PDFDocumentProxy> {
  const existing = docs.get(sourceId);
  if (existing) {
    docs.delete(sourceId);
    docs.set(sourceId, existing);
    return existing;
  }
  const entry = sources.get(sourceId);
  if (!entry) return Promise.reject(new Error('The source file is no longer available.'));
  const promise = openPdf(entry.file);
  docs.set(sourceId, promise);
  promise.catch(() => {
    if (docs.get(sourceId) === promise) docs.delete(sourceId);
  });
  while (docs.size > MAX_OPEN_DOCS) {
    const oldest = docs.keys().next().value as SourceFileId;
    const victim = docs.get(oldest);
    docs.delete(oldest);
    if (victim) destroyDoc(victim);
  }
  return promise;
}

function dropDocument(sourceId: SourceFileId): void {
  const promise = docs.get(sourceId);
  docs.delete(sourceId);
  if (promise) destroyDoc(promise);
}

/** Forget pages: revoke their thumbnails and drop sources that have no page left. */
export function forgetPages(pageIds: readonly PageId[]): void {
  const touched = new Set<SourceFileId>();
  for (const id of pageIds) {
    const entry = pages.get(id);
    if (!entry) continue;
    const url = entry.record.thumbnail?.url;
    if (url) URL.revokeObjectURL(url);
    pages.delete(id);
    touched.add(entry.sourceId);
  }
  for (const sourceId of touched) {
    let stillUsed = false;
    for (const entry of pages.values()) {
      if (entry.sourceId === sourceId) {
        stillUsed = true;
        break;
      }
    }
    if (!stillUsed) {
      dropDocument(sourceId);
      sources.delete(sourceId);
    }
  }
}

/** Forget everything (shutdown). */
export function forgetAll(): void {
  for (const entry of pages.values()) {
    const url = entry.record.thumbnail?.url;
    if (url) URL.revokeObjectURL(url);
  }
  pages.clear();
  for (const id of [...docs.keys()]) dropDocument(id);
  sources.clear();
}
