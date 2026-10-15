/** Node-side inspection of exported PDFs (pdf-lib for structure, pdf.js legacy build for text). */
import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

export interface PdfPageInfo {
  /** Text of the page, items joined by spaces. */
  text: string;
  /** The text runs of the page, in content-stream order. */
  items: string[];
  /** /Rotate of the page. */
  rotation: number;
  width: number;
  height: number;
  /** True when the page's resources contain at least one image XObject. */
  hasImage: boolean;
  /** Private `/ScanSorterTestPage` key written by scripts/make-fixtures.mjs for image-only pages. */
  testPage: number | null;
}

export async function inspectPdf(file: string): Promise<PdfPageInfo[]> {
  const bytes = new Uint8Array(readFileSync(file));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const out: PdfPageInfo[] = [];
    for (let i = 0; i < doc.getPageCount(); i += 1) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      const resources = page.node.Resources();
      const xobjects = resources?.lookup(PDFName.of('XObject'));
      let hasImage = false;
      if (xobjects instanceof PDFDict) {
        for (const [, ref] of xobjects.entries()) {
          const obj = doc.context.lookup(ref);
          if (obj instanceof PDFDict || (obj && 'dict' in obj)) {
            const dict = obj instanceof PDFDict ? obj : (obj as { dict: PDFDict }).dict;
            if (dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) hasImage = true;
          }
        }
      }
      const marker = page.node.get(PDFName.of('ScanSorterTestPage'));
      const content = await (await pdf.getPage(i + 1)).getTextContent();
      const items = content.items.map((item) => ('str' in item ? item.str.trim() : '')).filter((s) => s !== '');
      out.push({
        text: items.join(' '),
        items,
        rotation: page.getRotation().angle,
        width,
        height,
        hasImage,
        testPage: marker instanceof PDFNumber ? marker.asNumber() : null,
      });
    }
    return out;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** The page number printed on a fixture page: a run that is "12", "iv", "Page 3 of 10" or "- 37 -". */
export function printedNumber(page: Pick<PdfPageInfo, 'items'>): string | null {
  for (const run of page.items) {
    const m = /^(?:Page\s+)?(\d{1,4}|[ivx]{1,5})(?:\s+of\s+\d+)?$/.exec(run) ?? /^-\s*(\d{1,4})\s*-$/.exec(run);
    if (m) return m[1];
  }
  return null;
}
