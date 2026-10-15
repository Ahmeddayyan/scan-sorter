/**
 * Node-side proof that the pdf.js text-layer mapping is right: extract text from the generated
 * fixture PDFs with the legacy pdf.js build, run core inference and compare with the known
 * ground truth (see scripts/make-fixtures.mjs). Skipped when fixtures were not generated
 * (`npm run fixtures`).
 */
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, degrees, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { EMPTY_OVERRIDES, extractCandidates, formatPageNumber, inferDocument } from '../../core';
import type { InferenceResult, PageEvidence, PageRecord } from '../../core';
import { extractTextLayer } from '../pdf';

const FIXTURES = fileURLToPath(new URL('../../../test-fixtures/generated/', import.meta.url));
const have = existsSync(path.join(FIXTURES, 'shuffled-missing7-dup4.pdf'));

type LegacyPdfjs = typeof import('pdfjs-dist');

async function loadLegacy(): Promise<LegacyPdfjs> {
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as LegacyPdfjs;
}

async function pagesFromPdf(bytes: Uint8Array, name: string): Promise<PageRecord[]> {
  const pdfjs = await loadLegacy();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
  const pages: PageRecord[] = [];
  try {
    for (let i = 0; i < doc.numPages; i += 1) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const items = await extractTextLayer(page);
      const evidence: PageEvidence = {
        source: items.length > 0 ? 'text-layer' : 'none',
        bands: ['full'],
        items,
        hasTextLayer: items.length > 0,
      };
      pages.push({
        id: `p${i + 1}`,
        sourceFileId: 's1',
        sourceIndex: i,
        inputIndex: i,
        kind: 'pdf-page',
        label: `${name} · p.${i + 1}`,
        width: vp.width,
        height: vp.height,
        thumbnail: null,
        perceptualHash: null,
        evidence,
        candidates: extractCandidates(evidence).candidates,
        status: 'done',
      });
    }
  } finally {
    await doc.loadingTask.destroy();
  }
  return pages;
}

async function loadFixture(name: string): Promise<{ pages: PageRecord[]; result: InferenceResult }> {
  const bytes = new Uint8Array(readFileSync(path.join(FIXTURES, name)));
  const pages = await pagesFromPdf(bytes, name);
  return { pages, result: inferDocument(pages, { overrides: EMPTY_OVERRIDES }) };
}

const numbersInOrder = (r: InferenceResult): string[] =>
  r.order.map((id) => {
    const n = r.assignments[id].number;
    return n ? formatPageNumber(n) : '?';
  });

describe.skipIf(!have)('text-layer mapping against the generated fixtures', () => {
  it('shuffled-missing7-dup4: sorts 1..12, reports page 7 missing and page 4 duplicated', async () => {
    const { pages, result } = await loadFixture('shuffled-missing7-dup4.pdf');
    expect(pages).toHaveLength(12);
    expect(pages[0].width).toBe(612);
    expect(pages[0].height).toBe(792);
    expect(numbersInOrder(result)).toEqual(['1', '2', '3', '4', '4', '5', '6', '8', '9', '10', '11', '12']);
    expect(result.report.missing).toEqual([{ style: 'arabic', from: 7, to: 7, count: 1 }]);
    expect(result.report.duplicates.map((d) => d.number.value)).toEqual([4]);
    // footer is bottom-centre, decoy header / copyright line were not taken as numbers
    for (const page of pages) expect(page.candidates[0].region).toBe('bottom-center');
  });

  it('page-of-10-trailing-missing: reads "Page N of 10", reports 9-10 missing', async () => {
    const { result } = await loadFixture('page-of-10-trailing-missing.pdf');
    expect(numbersInOrder(result)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(result.detectedTotal).toBe(10);
    expect(result.report.missing).toEqual([{ style: 'arabic', from: 9, to: 10, count: 2 }]);
  });

  it('front-matter-roman: roman before arabic, one unnumbered page', async () => {
    const { result } = await loadFixture('front-matter-roman.pdf');
    const order = numbersInOrder(result);
    expect(order.filter((n) => n !== '?').sort()).toEqual(['1', '2', '3', '4', '5', '6', 'i', 'ii', 'iii', 'iv'].sort());
    expect(order.indexOf('iv')).toBeLessThan(order.indexOf('1'));
    expect(order.filter((n) => n === '?')).toHaveLength(1);
    expect(result.report.missing).toEqual([]);
  });

  it('book-alternating-21-36: bottom-left / bottom-right numbers, 21..36', async () => {
    const { pages, result } = await loadFixture('book-alternating-21-36.pdf');
    expect(numbersInOrder(result)).toEqual(Array.from({ length: 16 }, (_, i) => String(21 + i)));
    const regions = new Set(pages.map((p) => p.candidates[0]?.region));
    expect([...regions].sort()).toEqual(['bottom-left', 'bottom-right']);
    expect(result.layout?.alternating).toBe(true);
    expect(result.report.missing).toEqual([]);
  });

  it('excerpt-dashed-37-45: dashed header numbers, no leading gap reported', async () => {
    const { pages, result } = await loadFixture('excerpt-dashed-37-45.pdf');
    expect(numbersInOrder(result)).toEqual(Array.from({ length: 9 }, (_, i) => String(37 + i)));
    expect(pages[0].candidates[0].region).toBe('top-center');
    expect(result.report.missing).toEqual([]);
    expect(result.report.notes.some((n) => n.kind === 'starts-above-one')).toBe(true);
  });

  it('unnumbered: has a text layer but no candidates (the pipeline would OCR these)', async () => {
    const { pages, result } = await loadFixture('unnumbered.pdf');
    for (const page of pages) {
      expect(page.evidence.hasTextLayer).toBe(true);
      expect(page.candidates.filter((c) => c.region !== 'body')).toEqual([]);
    }
    expect(result.report.summary.numbered).toBe(0);
  });
});

describe('text-layer mapping honours /Rotate', () => {
  it('maps text from a page rotated by 90 degrees onto the upright page', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    // Unrotated bottom-left corner of the content.
    page.drawText('42', { x: 40, y: 30, size: 12, font });
    page.setRotation(degrees(90));
    const bytes = await doc.save();

    const pdfjs = await loadLegacy();
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    try {
      const p = await pdf.getPage(1);
      const vp = p.getViewport({ scale: 1 });
      expect(vp.width).toBe(800); // upright page is landscape after /Rotate 90
      expect(vp.height).toBe(600);
      const items = await extractTextLayer(p);
      expect(items).toHaveLength(1);
      // Rotating 90 degrees clockwise sends the bottom-left corner to the top-left corner.
      expect(items[0].box.x).toBeLessThan(0.1);
      expect(items[0].box.y).toBeLessThan(0.1);
      expect(items[0].box.x + items[0].box.w).toBeLessThanOrEqual(1);
      expect(items[0].box.y + items[0].box.h).toBeLessThanOrEqual(1);
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
});
