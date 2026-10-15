#!/usr/bin/env node
/**
 * Generates synthetic test inputs into test-fixtures/generated/ for the pipeline tests, the
 * Playwright end-to-end suite and manual testing. Run with `npm run fixtures`.
 *
 *   Digital PDFs (text layer):  shuffled-missing7-dup4, page-of-10-trailing-missing,
 *                               front-matter-roman, book-alternating-21-36, excerpt-dashed-37-45,
 *                               unnumbered, long-1-50 (timing), big-shuffled-240 (cancel test)
 *   Scan-like inputs (no text layer, OCR path), rendered with @napi-rs/canvas when available:
 *                               scan-only-1-10.pdf (JPEG page images), photo-p1.png,
 *                               photo-p2-exif6.jpg (EXIF orientation 6), photo-p3.webp
 *   Unsupported:                notes.txt
 *
 * Every scan page in scan-only-1-10.pdf carries a private `/ScanSorterTestPage N` key in its
 * page dictionary so tests can verify the exported order without OCR (pdf-lib copies it).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, rgb } from 'pdf-lib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-fixtures', 'generated');
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
/** @type {typeof import('@napi-rs/canvas') | null} */
let napiCanvas = null;
try {
  napiCanvas = require('@napi-rs/canvas');
} catch {
  napiCanvas = null;
}

const PAGE = [612, 792]; // US Letter, points
const MARGIN = 54;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle(items, seed = 1) {
  const rand = seeded(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * @typedef {{ footer?: string, footerAt?: 'left'|'center'|'right', header?: string, headerAt?: 'left'|'center'|'right',
 *             body?: string, extraFooter?: string, extraFooterAt?: 'left'|'center'|'right', title?: string }} PageSpec
 */

/** @param {PageSpec[]} specs */
async function buildPdf(specs, file) {
  const doc = await PDFDocument.create();
  doc.setTitle(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [w, h] = PAGE;
  const place = (text, at, size) => {
    const tw = font.widthOfTextAtSize(text, size);
    if (at === 'left') return MARGIN;
    if (at === 'right') return w - MARGIN - tw;
    return (w - tw) / 2;
  };
  for (const spec of specs) {
    const page = doc.addPage(PAGE);
    if (spec.title) {
      page.drawText(spec.title, { x: MARGIN, y: h - 200, size: 28, font: bold, color: rgb(0.1, 0.1, 0.1) });
    }
    const body = spec.body ?? loremLines(spec.title ? 14 : 30);
    body.forEach((line, i) => {
      page.drawText(line, { x: MARGIN, y: h - (spec.title ? 250 : 110) - i * 16, size: 11, font, color: rgb(0.15, 0.15, 0.15) });
    });
    if (spec.header) {
      page.drawText(spec.header, { x: place(spec.header, spec.headerAt ?? 'left', 9), y: h - MARGIN + 10, size: 9, font });
    }
    if (spec.footer) {
      page.drawText(spec.footer, { x: place(spec.footer, spec.footerAt ?? 'center', 10), y: MARGIN - 20, size: 10, font });
    }
    if (spec.extraFooter) {
      page.drawText(spec.extraFooter, { x: place(spec.extraFooter, spec.extraFooterAt ?? 'left', 8), y: MARGIN - 20, size: 8, font });
    }
  }
  const bytes = await doc.save();
  writeFileSync(path.join(OUT, file), bytes);
  console.log(`fixtures: wrote ${file} (${specs.length} pages)`);
}

function loremLines(n) {
  const words = 'the quick brown fox jumps over the lazy dog while reading a long contract about scanning pages and sorting them again'.split(' ');
  const rand = seeded(n);
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const len = 8 + Math.floor(rand() * 6);
    const line = [];
    for (let k = 0; k < len; k += 1) line.push(words[Math.floor(rand() * words.length)]);
    lines.push(line.join(' ') + '.');
  }
  return lines;
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const roman = (n) => ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][n];

// 1. Shuffled, page 7 missing, page 4 scanned twice, decoy header/footer text.
await buildPdf(
  shuffle(
    [...range(1, 12).filter((n) => n !== 7), 4].map((n) => ({
      footer: String(n),
      header: 'Chapter 2 · Scanning basics',
      extraFooter: '© 2021 Example Press · Printed 12/03/2021',
      extraFooterAt: 'left',
      title: n === 1 ? '2  Scanning basics' : undefined,
    })),
    3,
  ),
  'shuffled-missing7-dup4.pdf',
);

// 2. "Page N of 10" footers, pages 9-10 missing, shuffled.
await buildPdf(
  shuffle(range(1, 8).map((n) => ({ footer: `Page ${n} of 10` })), 5),
  'page-of-10-trailing-missing.pdf',
);

// 3. Roman front matter + arabic body, shuffled; one unnumbered insert page.
await buildPdf(
  shuffle(
    [
      ...range(1, 4).map((n) => ({ footer: roman(n), footerAt: 'center' })),
      ...range(1, 6).map((n) => ({ footer: String(n), header: 'Introduction', headerAt: 'left' })),
      { body: ['(this page intentionally left blank)'] },
    ],
    8,
  ),
  'front-matter-roman.pdf',
);

// 4. Book scan style: odd pages bottom-right, even pages bottom-left, running heads, shuffled.
await buildPdf(
  shuffle(
    range(1, 16).map((n) => ({
      footer: String(n + 20),
      footerAt: n % 2 === 1 ? 'right' : 'left',
      header: n % 2 === 1 ? 'THE ART OF SORTING' : 'CHAPTER 3',
      headerAt: n % 2 === 1 ? 'right' : 'left',
    })),
    13,
  ),
  'book-alternating-21-36.pdf',
);

// 5. Dashed numbers "- 5 -" in the header, starts above 1 (excerpt), shuffled.
await buildPdf(
  shuffle(range(37, 45).map((n) => ({ header: `- ${n} -`, headerAt: 'center' })), 21),
  'excerpt-dashed-37-45.pdf',
);

// 6. No numbers at all.
await buildPdf(range(1, 4).map(() => ({})), 'unnumbered.pdf');

// 7. 50 numbered pages, shuffled (text-layer timing).
await buildPdf(
  shuffle(range(1, 50).map((n) => ({ footer: String(n), header: 'Lecture notes', headerAt: 'left' })), 34),
  'long-1-50.pdf',
);

// 8. 240 pages, shuffled; every third page has no footer number so it goes through OCR
//    (cancel-mid-run test: the run must take long enough to be stopped).
await buildPdf(
  shuffle(
    range(1, 240).map((n) => ({
      footer: n % 3 === 0 ? undefined : String(n),
      header: 'Annual report',
      headerAt: 'right',
    })),
    55,
  ),
  'big-shuffled-240.pdf',
);

// 8b. Appendix 51-60 (queued-drop test: merges with long-1-50 without conflicts).
await buildPdf(
  shuffle(range(51, 60).map((n) => ({ footer: String(n), header: 'Appendix', headerAt: 'left' })), 89),
  'appendix-51-60.pdf',
);

// 9. Unsupported input.
writeFileSync(path.join(OUT, 'notes.txt'), 'This is not a scan.\n');
console.log('fixtures: wrote notes.txt');

// ---------------------------------------------------------------------------
// Scan-like inputs (no text layer) - need @napi-rs/canvas (an optional dependency of pdfjs-dist)
// ---------------------------------------------------------------------------

const SCAN_W = 2480; // A4 at 300 dpi
const SCAN_H = 3508;

/**
 * Draw a "scanned page": a heading, some body lines and a footer. The pixels are what OCR sees.
 * @param {{ title: string, lines: string[], footer: string | null, footerAt?: 'left'|'center'|'right' }} spec
 */
function drawScanPage(spec, width = SCAN_W, height = SCAN_H) {
  const { createCanvas } = napiCanvas;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const s = width / SCAN_W;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1a1a1a';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold ${Math.round(96 * s)}px Arial`;
  ctx.fillText(spec.title, 220 * s, 420 * s);
  ctx.font = `${Math.round(46 * s)}px Arial`;
  spec.lines.forEach((line, i) => {
    ctx.fillText(line, 220 * s, (560 + i * 76) * s);
  });
  if (spec.footer) {
    ctx.font = `${Math.round(48 * s)}px Arial`;
    const tw = ctx.measureText(spec.footer).width;
    const at = spec.footerAt ?? 'center';
    const x = at === 'left' ? 220 * s : at === 'right' ? width - 220 * s - tw : (width - tw) / 2;
    ctx.fillText(spec.footer, x, height - 190 * s);
  }
  return canvas;
}

/** Rotate a canvas 90 degrees counter-clockwise (so EXIF orientation 6 = "rotate 90 CW" uprights it). */
function rotateCcw(canvas) {
  const { createCanvas } = napiCanvas;
  const out = createCanvas(canvas.height, canvas.width);
  const ctx = out.getContext('2d');
  ctx.translate(0, out.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/** Insert an APP1 Exif segment with only the Orientation tag right after the JPEG SOI marker. */
function withExifOrientation(jpeg, orientation) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'latin1'); // little-endian
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 offset
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(0x0112, 10); // Orientation
  tiff.writeUInt16LE(3, 12); // SHORT
  tiff.writeUInt32LE(1, 14); // count
  tiff.writeUInt16LE(orientation, 18); // value (left-justified in the 4-byte field)
  tiff.writeUInt16LE(0, 20);
  tiff.writeUInt32LE(0, 22); // next IFD
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]);
}

const SCAN_LINES = [
  'The quick brown fox jumps over the lazy dog while the scanner feeder',
  'drops every other sheet on the floor. These lines exist so that each',
  'page looks a little different from the others when it is hashed.',
];

if (!napiCanvas) {
  console.warn('fixtures: @napi-rs/canvas is not installed - skipping the scan-like fixtures (OCR tests will be skipped).');
} else {
  // 10. Image-only PDF: 10 JPEG pages "Page N of 10", shuffled, no text layer.
  {
    const doc = await PDFDocument.create();
    doc.setTitle('scan-only-1-10.pdf');
    const order = shuffle(range(1, 10), 77);
    for (const n of order) {
      const canvas = drawScanPage({
        title: `Section ${n}`,
        lines: SCAN_LINES.slice(0, 1 + (n % 3)),
        footer: `Page ${n} of 10`,
      });
      const jpeg = await doc.embedJpg(canvas.toBuffer('image/jpeg', 80));
      const page = doc.addPage(PAGE);
      page.drawImage(jpeg, { x: 0, y: 0, width: PAGE[0], height: PAGE[1] });
      page.node.set(PDFName.of('ScanSorterTestPage'), PDFNumber.of(n));
    }
    writeFileSync(path.join(OUT, 'scan-only-1-10.pdf'), await doc.save());
    console.log(`fixtures: wrote scan-only-1-10.pdf (10 image pages, order ${order.join(',')})`);
  }

  // 11. Photos of pages 1-3 as PNG, JPEG (EXIF orientation 6, stored sideways) and WebP.
  const photo = (n) =>
    drawScanPage(
      { title: `Field notes ${n}`, lines: SCAN_LINES.slice(0, 1 + (n % 3)), footer: `Page ${n}` },
      1654, // A4 at 200 dpi
      2339,
    );
  writeFileSync(path.join(OUT, 'photo-p1.png'), photo(1).toBuffer('image/png'));
  writeFileSync(
    path.join(OUT, 'photo-p2-exif6.jpg'),
    withExifOrientation(rotateCcw(photo(2)).toBuffer('image/jpeg', 85), 6),
  );
  writeFileSync(path.join(OUT, 'photo-p3.webp'), photo(3).toBuffer('image/webp', 82));
  console.log('fixtures: wrote photo-p1.png, photo-p2-exif6.jpg (sideways + EXIF 6), photo-p3.webp');
}

console.log(`fixtures: done -> ${path.relative(ROOT, OUT)}/`);
