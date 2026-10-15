/**
 * Orchestration test for processFiles with the browser/engine edges mocked (canvas, pdf.js,
 * tesseract): checks ordering, ids, progress, the text-layer -> OCR hand-off, errors and
 * cancellation without needing a DOM.
 */
/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageRecord, PipelineProgress, TextItem } from '../../core';

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn(),
  getScheduler: vi.fn(),
}));

vi.mock('../canvas', () => ({
  createCanvas: (width: number, height: number) => ({ width, height }),
  getContext: () => ({}),
  fillWhite: () => undefined,
  canvasToBlob: () => Promise.resolve(new Blob(['jpeg'])),
  canvasToOcrPng: () => Promise.resolve(new Blob(['png'])),
  releaseCanvas: () => undefined,
  perceptualHashOf: () => '0123456789abcdef',
}));

vi.mock('../ocr', () => ({
  addOcrListener: () => () => undefined,
  getScheduler: mocks.getScheduler,
  recognizeBlob: mocks.recognize,
  terminateScheduler: mocks.terminate,
}));

vi.mock('../image', () => ({
  ImagePageSource: { open: () => Promise.reject(new Error('no images in this test')) },
  renderImagePreview: () => Promise.reject(new Error('unused')),
}));

const footer = (text: string): TextItem => ({ text, box: { x: 0.47, y: 0.94, w: 0.06, h: 0.012 }, confidence: 1 });

vi.mock('../pdf', () => {
  /** A file whose text is "pages=N" has N pages; even-indexed pages have a text-layer footer. */
  class FakePage {
    readonly kind = 'pdf-page' as const;
    readonly width = 612;
    readonly height = 792;
    private readonly index: number;
    constructor(index: number) {
      this.index = index;
    }
    readTextLayer() {
      return Promise.resolve(this.index % 2 === 0 ? [footer(String(this.index + 1))] : []);
    }
    renderThumbnail() {
      return Promise.resolve({ width: 186, height: 240 });
    }
    renderRegion(rect: { width: number; height: number }, scale: number) {
      return Promise.resolve({ width: Math.ceil(rect.width * scale), height: Math.ceil(rect.height * scale) });
    }
    trim() {}
    dispose() {}
  }
  return {
    openPdf: async (blob: Blob) => {
      const text = await blob.text();
      const n = /pages=(\d+)/.exec(text);
      if (!n) throw new Error('Invalid PDF structure.');
      return { numPages: Number(n[1]), loadingTask: { destroy: () => Promise.resolve() } };
    },
    PdfPageSource: { open: (_doc: unknown, index: number) => Promise.resolve(new FakePage(index)) },
    renderPdfPreview: () => Promise.reject(new Error('unused')),
  };
});

const { processFiles, releasePages } = await import('../process');

const pdf = (name: string, pages: number): File => new File([`pages=${pages}`], name, { type: 'application/pdf' });

function collect() {
  const pages: PageRecord[] = [];
  const progress: PipelineProgress[] = [];
  const errors: string[] = [];
  const sources: string[] = [];
  return {
    pages,
    progress,
    errors,
    sources,
    callbacks: {
      onSource: (s: { id: string }) => sources.push(s.id),
      onPage: (p: PageRecord) => pages.push(p),
      onProgress: (p: PipelineProgress) => progress.push(p),
      onError: (e: { message: string }) => errors.push(e.message),
    },
  };
}

/** A tesseract-like answer: the word "9" in the middle of the crop. */
const nineBlocks = [
  { paragraphs: [{ lines: [{ words: [{ text: '9', confidence: 92, bbox: { x0: 1250, y0: 200, x1: 1300, y1: 240 } }] }] }] },
];

beforeEach(() => {
  mocks.recognize.mockReset().mockResolvedValue(nineBlocks);
  mocks.terminate.mockReset().mockResolvedValue(undefined);
  mocks.getScheduler.mockReset().mockResolvedValue({ scheduler: {}, workers: 2 });
});

describe('processFiles (mocked engines)', () => {
  it('emits pending then done per page, uses the text layer when possible and OCR otherwise', async () => {
    const c = collect();
    const result = await processFiles([pdf('a.pdf', 4)], c.callbacks);
    expect(result.cancelled).toBe(false);
    expect(result.sources).toHaveLength(1);
    expect(result.pages).toHaveLength(4);
    expect(c.sources).toEqual([result.sources[0].id]);
    expect(result.sources[0].pageCount).toBe(4);

    // each page: first emission is pending with a thumbnail, last is done
    for (const page of result.pages) {
      const emissions = c.pages.filter((p) => p.id === page.id);
      expect(emissions.length).toBeGreaterThanOrEqual(2);
      expect(emissions[0].status).toBe('pending');
      expect(emissions[0].thumbnail?.url).toMatch(/^blob:/);
      expect(emissions[0].perceptualHash).toBe('0123456789abcdef');
      expect(emissions[emissions.length - 1].status).toBe('done');
    }
    expect(result.pages.map((p) => p.inputIndex)).toEqual([0, 1, 2, 3]);
    expect(result.pages.map((p) => p.sourceIndex)).toEqual([0, 1, 2, 3]);
    expect(result.pages.map((p) => p.evidence.source)).toEqual(['text-layer', 'ocr', 'text-layer', 'ocr']);
    expect(result.pages[0].candidates[0].number.value).toBe(1);
    expect(result.pages[1].candidates[0].number.value).toBe(9);
    expect(result.pages[1].evidence.bands).toEqual(['top', 'bottom']);
    // two band crops per OCR page
    expect(mocks.recognize).toHaveBeenCalledTimes(4);

    const last = c.progress[c.progress.length - 1];
    expect(last).toMatchObject({ phase: 'done', totalPages: 4, renderedPages: 4, analyzedPages: 4, ocrPages: 2 });
    releasePages(result.pages.map((p) => p.id));
  });

  it('keeps ids unique across calls and continues the input numbering', async () => {
    const first = await processFiles([pdf('a.pdf', 2)], collect().callbacks);
    const second = await processFiles([pdf('a.pdf', 2), pdf('b.pdf', 1)], collect().callbacks, {
      startInputIndex: 2,
      startSourceIndex: 1,
    });
    const ids = [...first.pages, ...second.pages].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.pages.map((p) => p.inputIndex)).toEqual([2, 3, 4]);
    expect(second.sources.map((s) => s.inputIndex)).toEqual([1, 2]);
    expect(first.sources[0].id).not.toBe(second.sources[0].id);
  });

  it('rejects unsupported files with a clear error and still processes the rest', async () => {
    const c = collect();
    const result = await processFiles(
      [new File(['x'], 'notes.docx', { type: '' }), pdf('ok.pdf', 1)],
      c.callbacks,
    );
    expect(c.errors.some((m) => m.includes('notes.docx') && m.includes('not a supported file'))).toBe(true);
    expect(result.sources).toHaveLength(1);
    expect(result.pages).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('reports an unreadable PDF and carries on with the next file', async () => {
    const c = collect();
    const broken = new File(['garbage'], 'broken.pdf', { type: 'application/pdf' });
    const result = await processFiles([broken, pdf('ok.pdf', 2)], c.callbacks);
    expect(result.sources.map((s) => s.name)).toEqual(['ok.pdf']);
    expect(result.pages).toHaveLength(2);
    expect(c.errors[0]).toContain('broken.pdf');
    expect(c.progress[c.progress.length - 1].totalPages).toBe(2);
  });

  it('turns an OCR failure into an error page without aborting the batch', async () => {
    mocks.recognize.mockRejectedValueOnce(new Error('worker crashed')).mockResolvedValue(nineBlocks);
    const c = collect();
    const result = await processFiles([pdf('a.pdf', 4)], c.callbacks);
    const statuses = result.pages.map((p) => p.status);
    expect(statuses.filter((s) => s === 'error')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'done')).toHaveLength(3);
    const bad = result.pages.find((p) => p.status === 'error');
    expect(bad?.error).toContain('worker crashed');
    expect(bad?.candidates).toEqual([]);
    expect(bad?.evidence.source).toBe('none');
  });

  it('reports a missing OCR engine as an error per OCR page and still finishes', async () => {
    mocks.getScheduler.mockRejectedValue(new Error('404 worker.min.js'));
    const c = collect();
    const result = await processFiles([pdf('a.pdf', 4)], c.callbacks);
    expect(result.pages.map((p) => p.status)).toEqual(['done', 'error', 'done', 'error']);
    expect(c.errors.some((m) => m.includes('OCR engine failed to load'))).toBe(true);
  });

  it('with ocr "never" does not touch the OCR engine', async () => {
    const result = await processFiles([pdf('a.pdf', 4)], collect().callbacks, { ocr: 'never' });
    expect(mocks.getScheduler).not.toHaveBeenCalled();
    expect(result.pages.map((p) => p.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(result.pages[1].candidates).toEqual([]);
  });

  it('resolves promptly with cancelled: true even if OCR jobs never answer', async () => {
    mocks.recognize.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const c = collect();
    const done = processFiles([pdf('big.pdf', 40)], {
      ...c.callbacks,
      onPage: (p) => {
        c.callbacks.onPage(p);
        if (p.id.endsWith('-p3')) controller.abort();
      },
    }, { signal: controller.signal });
    const result = await Promise.race([
      done,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000)),
    ]);
    expect(result).not.toBe('timeout');
    if (result === 'timeout') return;
    expect(result.cancelled).toBe(true);
    expect(result.pages.length).toBeLessThan(40);
    expect(mocks.terminate).toHaveBeenCalled();
    expect(c.progress[c.progress.length - 1].phase).toBe('cancelled');
  });

  it('returns immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const c = collect();
    const result = await processFiles([pdf('a.pdf', 3)], c.callbacks, { signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.pages).toEqual([]);
    expect(c.pages).toEqual([]);
  });

  it('bounds how far rendering runs ahead of slow OCR', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.recognize.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return nineBlocks;
    });
    const c = collect();
    let maxAhead = 0;
    const result = await processFiles([pdf('a.pdf', 41)], {
      ...c.callbacks,
      onPage: (p) => {
        c.callbacks.onPage(p);
        const rendered = new Set(c.pages.map((x) => x.id)).size;
        const finished = new Set(c.pages.filter((x) => x.status !== 'pending').map((x) => x.id)).size;
        maxAhead = Math.max(maxAhead, rendered - finished);
      },
    }, { ocrWorkers: 2 });
    expect(result.pages).toHaveLength(41);
    expect(result.pages.every((p) => p.status === 'done')).toBe(true);
    // queue capacity (2 x 2 workers) + pages currently in OCR + the one being rendered
    expect(maxAhead).toBeLessThanOrEqual(4 + 2 + 2);
    expect(maxInFlight).toBeLessThanOrEqual(4); // 2 consumers x 2 bands
  });
});
