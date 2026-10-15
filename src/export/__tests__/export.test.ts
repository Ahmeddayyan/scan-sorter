/**
 * Runs `exportSortedPdf` in Node (pdf-lib only; the canvas re-encoding path is browser-only)
 * on the generated fixtures and on synthetic PDFs, then re-reads the output.
 */
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { EMPTY_OVERRIDES, buildExportPlan, extractCandidates, inferDocument } from '../../core';
import type { ExportPage, ExportPlan, PageRecord, SourceFile } from '../../core';
import { exportSortedPdf } from '../index';

const FIXTURE = fileURLToPath(new URL('../../../test-fixtures/generated/shuffled-missing7-dup4.pdf', import.meta.url));

async function makePdf(labels: string[], rotations: number[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  labels.forEach((label, i) => {
    const page = doc.addPage([200 + i * 10, 300]); // width encodes the page identity
    page.drawText(label, { x: 20, y: 20, size: 10 });
    if (rotations[i]) page.setRotation(degrees(rotations[i]));
  });
  return doc.save();
}

const blobOf = (bytes: Uint8Array): Blob => new Blob([bytes as BlobPart], { type: 'application/pdf' });

function plan(pages: Partial<ExportPage>[], fileName = 'out-sorted.pdf'): ExportPlan {
  return {
    fileName,
    pages: pages.map((p, i) => ({
      pageId: `p${i}`,
      sourceFileId: 's1',
      sourceIndex: 0,
      kind: 'pdf-page' as const,
      rotation: 0 as const,
      number: null,
      ...p,
    })),
  };
}

describe('exportSortedPdf', () => {
  it('copies pages in plan order across several sources and reports progress', async () => {
    const a = await makePdf(['a1', 'a2', 'a3']);
    const b = await makePdf(['b1', 'b2']);
    const progress: [number, number][] = [];
    const result = await exportSortedPdf({
      plan: plan([
        { sourceFileId: 'b', sourceIndex: 1 },
        { sourceFileId: 'a', sourceIndex: 2 },
        { sourceFileId: 'a', sourceIndex: 0 },
        { sourceFileId: 'b', sourceIndex: 0 },
      ]),
      sources: new Map([
        ['a', blobOf(a)],
        ['b', blobOf(b)],
      ]),
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(result.pageCount).toBe(4);
    expect(result.fileName).toBe('out-sorted.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(progress).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);

    const out = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    expect(out.getPageCount()).toBe(4);
    // widths: a = 200,210,220; b = 200,210  -> expect b2, a3, a1, b1
    expect(out.getPages().map((p) => p.getWidth())).toEqual([210, 220, 200, 200]);
  });

  it('adds the user rotation on top of the page rotation', async () => {
    const src = await makePdf(['x', 'y'], [90, 0]);
    const result = await exportSortedPdf({
      plan: plan([
        { sourceIndex: 0, rotation: 90 },
        { sourceIndex: 1, rotation: 270 },
        { sourceIndex: 0, rotation: 0 },
      ]),
      sources: new Map([['s1', blobOf(src)]]),
    });
    const out = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([180, 270, 90]);
  });

  it('writes bookmarks for numbered pages when asked', async () => {
    const src = await makePdf(['1', '2', '3']);
    const result = await exportSortedPdf({
      plan: plan([
        { sourceIndex: 0, number: { value: 1, style: 'roman' } },
        { sourceIndex: 1, number: null },
        { sourceIndex: 2, number: { value: 17, style: 'arabic' } },
      ]),
      sources: new Map([['s1', blobOf(src)]]),
      addBookmarks: true,
    });
    const out = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    const outlines = out.catalog.lookup(PDFName.of('Outlines'));
    expect(outlines).toBeDefined();
    const dict = out.context.lookup(out.catalog.get(PDFName.of('Outlines'))!) as unknown as {
      get(name: PDFName): { toString(): string } | undefined;
    };
    expect(dict.get(PDFName.of('Count'))?.toString()).toBe('2');
    const without = await exportSortedPdf({
      plan: plan([{ sourceIndex: 0, number: { value: 1, style: 'arabic' } }]),
      sources: new Map([['s1', blobOf(src)]]),
    });
    const plain = await PDFDocument.load(new Uint8Array(await without.blob.arrayBuffer()));
    expect(plain.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
  });

  it('embeds PNG image pages fitted to A4', async () => {
    // 2x1 opaque PNG
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==')
        .split('')
        .map((c) => c.charCodeAt(0)),
    );
    const src = await makePdf(['a']);
    const result = await exportSortedPdf({
      plan: plan([
        { sourceFileId: 'img', sourceIndex: 0, kind: 'image', rotation: 90 },
        { sourceFileId: 's1', sourceIndex: 0 },
      ]),
      sources: new Map([
        ['img', new Blob([png as BlobPart], { type: 'image/png' })],
        ['s1', blobOf(src)],
      ]),
    });
    const out = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    expect(out.getPageCount()).toBe(2);
    const first = out.getPage(0);
    expect(first.getWidth()).toBeCloseTo(841.89, 1); // landscape A4 long side
    expect(first.getHeight()).toBeCloseTo(420.945, 1);
    expect(first.getRotation().angle).toBe(90);
  });

  it('rejects with AbortError when cancelled', async () => {
    const src = await makePdf(['a', 'b']);
    const controller = new AbortController();
    const promise = exportSortedPdf({
      plan: plan([{ sourceIndex: 0 }, { sourceIndex: 1 }]),
      sources: new Map([['s1', blobOf(src)]]),
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    const pre = new AbortController();
    pre.abort();
    await expect(
      exportSortedPdf({ plan: plan([{}]), sources: new Map([['s1', blobOf(src)]]), signal: pre.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports missing sources, bad page indices, unreadable files and empty plans clearly', async () => {
    const src = await makePdf(['a']);
    await expect(exportSortedPdf({ plan: plan([{}]), sources: new Map() })).rejects.toThrow(/missing/);
    await expect(
      exportSortedPdf({ plan: plan([{ sourceIndex: 5 }]), sources: new Map([['s1', blobOf(src)]]) }),
    ).rejects.toThrow(/does not exist/);
    await expect(
      exportSortedPdf({ plan: plan([{}]), sources: new Map([['s1', new File(['not a pdf'], 'broken.pdf')]]) }),
    ).rejects.toThrow(/broken\.pdf/);
    await expect(exportSortedPdf({ plan: plan([]), sources: new Map() })).rejects.toThrow(/no pages/);
  });
});

describe.skipIf(!existsSync(FIXTURE))('export from a real fixture via core buildExportPlan', () => {
  it('writes the sorted fixture: 12 pages, in numeric order', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist');
    const { extractTextLayer } = await import('../../pipeline/pdf');
    const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    const pages: PageRecord[] = [];
    for (let i = 0; i < doc.numPages; i += 1) {
      const p = await doc.getPage(i + 1);
      const items = await extractTextLayer(p);
      const evidence = { source: 'text-layer' as const, bands: ['full' as const], items, hasTextLayer: true };
      pages.push({
        id: `p${i + 1}`,
        sourceFileId: 's1',
        sourceIndex: i,
        inputIndex: i,
        kind: 'pdf-page',
        label: `p${i + 1}`,
        width: 612,
        height: 792,
        thumbnail: null,
        perceptualHash: null,
        evidence,
        candidates: extractCandidates(evidence).candidates,
        status: 'done',
      });
    }
    await doc.loadingTask.destroy();

    const result = inferDocument(pages, { overrides: EMPTY_OVERRIDES });
    const source: SourceFile = {
      id: 's1',
      name: 'shuffled-missing7-dup4.pdf',
      kind: 'pdf',
      mimeType: 'application/pdf',
      size: bytes.length,
      inputIndex: 0,
      pageCount: 12,
    };
    const exportPlan = buildExportPlan(pages, result, EMPTY_OVERRIDES, [source]);
    expect(exportPlan.fileName).toBe('shuffled-missing7-dup4-sorted.pdf');
    const out = await exportSortedPdf({
      plan: exportPlan,
      sources: new Map([['s1', blobOf(bytes)]]),
      addBookmarks: true,
    });
    expect(out.pageCount).toBe(12);
    const loaded = await PDFDocument.load(new Uint8Array(await out.blob.arrayBuffer()));
    expect(loaded.getPageCount()).toBe(12);

    // Re-read the exported text: the footers must now read 1,2,3,4,4,5,6,8,...,12.
    const again = await pdfjs.getDocument({ data: new Uint8Array(await out.blob.arrayBuffer()), verbosity: 0 }).promise;
    const footers: string[] = [];
    for (let i = 0; i < again.numPages; i += 1) {
      const items = await extractTextLayer(await again.getPage(i + 1));
      const bottom = items.filter((it) => it.box.y > 0.9);
      footers.push(bottom.map((b) => b.text).filter((t) => /^\d+$/.test(t.trim())).join(''));
    }
    await again.loadingTask.destroy();
    expect(footers).toEqual(['1', '2', '3', '4', '4', '5', '6', '8', '9', '10', '11', '12']);
  });
});
