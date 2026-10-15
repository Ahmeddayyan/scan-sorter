/**
 * Demo mode (`?demo`): ~32 synthetic pages so the whole UI can be exercised without the
 * pipeline. Evidence is realistic text boxes run through the REAL `extractCandidates`, so
 * `inferDocument` produces genuine results. Thumbnails are generated SVG data URLs that
 * look like little paper pages with a footer number.
 *
 * The scenario (deterministic):
 *   - roman front matter i, ii, iii
 *   - body pages 1..26 with page 14 MISSING
 *   - page 9 scanned twice (identical hash)               -> duplicate-scan
 *   - a different-looking page that also reads "20"        -> conflict
 *   - two pages without any number (a figure, a back side) -> unnumbered
 *   - pages 5, 12, 19 read with poor OCR confidence, and a "1O" misread for 10
 */
import type { PageEvidence, PageRecord, SourceFile, TextItem } from '../core';
import { extractCandidates } from '../core';

export const DEMO_PAGE_WIDTH = 612;
export const DEMO_PAGE_HEIGHT = 792;
const THUMB_W = 240;
const THUMB_H = 311;

interface DemoSpec {
  /** Printed footer text; null = no number on the page. */
  footer: string | null;
  /** Seed for the page "content" and hash. Identical seeds = identical scans. */
  seed: number;
  /** OCR word confidence (1 = exact text layer). */
  confidence: number;
  /** What the thumbnail shows besides text lines. */
  figure: boolean;
  blank: boolean;
  /** Accent colour of the title bar. */
  tint: string;
}

const TINTS = ['#6a8fd8', '#7fb08a', '#d9a35f', '#b385c9', '#d27c7c'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashFromSeed(seed: number): string {
  const rand = mulberry32(seed * 7919 + 13);
  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += Math.floor(rand() * 16).toString(16);
  return hex;
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function specs(): DemoSpec[] {
  const list: DemoSpec[] = [];
  const make = (footer: string | null, seed: number, extra: Partial<DemoSpec> = {}): void => {
    list.push({
      footer,
      seed,
      confidence: 1,
      figure: seed % 5 === 0,
      blank: false,
      tint: TINTS[Math.floor(seed / 6) % TINTS.length]!,
      ...extra,
    });
  };
  for (const [i, r] of ['i', 'ii', 'iii'].entries()) make(r, 100 + i, { tint: '#8a8f99', figure: false });
  const lowConfidence = new Set([5, 12, 19]);
  for (let n = 1; n <= 26; n += 1) {
    if (n === 14) continue; // the missing page
    if (n === 10) make('1O', n, { confidence: 0.62 }); // OCR read the zero as a letter O
    else make(String(n), n, lowConfidence.has(n) ? { confidence: 0.42 } : {});
  }
  make('9', 9); // same sheet scanned again: identical seed -> identical hash
  make('20', 200, { figure: false }); // a different page that also reads 20
  make(null, 300, { figure: true });
  make(null, 301, { figure: false, blank: true });
  return list;
}

function footerItems(spec: DemoSpec): TextItem[] {
  if (spec.footer === null) return [];
  const cw = 0.0075;
  const h = 0.012;
  const width = spec.footer.length * cw;
  return [
    {
      text: spec.footer,
      box: { x: 0.5 - width / 2, y: 0.95 - h / 2, w: width, h },
      confidence: spec.confidence,
    },
  ];
}

function evidenceFor(spec: DemoSpec): PageEvidence {
  const items = footerItems(spec);
  if (spec.confidence < 1) {
    return { source: 'ocr', bands: ['top', 'bottom'], items, hasTextLayer: false };
  }
  return items.length > 0
    ? { source: 'text-layer', bands: ['full'], items, hasTextLayer: true }
    : { source: 'none', bands: ['full'], items: [], hasTextLayer: false };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A tiny paper-page picture with a footer number. Exported for tests. */
export function pageSvgDataUrl(spec: Pick<DemoSpec, 'footer' | 'seed' | 'figure' | 'blank' | 'tint'>): string {
  const rand = mulberry32(spec.seed * 31 + 7);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${THUMB_W} ${THUMB_H}" width="${THUMB_W}" height="${THUMB_H}">`);
  parts.push(`<rect width="${THUMB_W}" height="${THUMB_H}" fill="#fdfdfb"/>`);
  parts.push(`<rect x="0.5" y="0.5" width="${THUMB_W - 1}" height="${THUMB_H - 1}" fill="none" stroke="#d6d6d0"/>`);
  if (!spec.blank) {
    parts.push(`<rect x="24" y="26" width="${60 + Math.floor(rand() * 90)}" height="9" rx="2" fill="${spec.tint}"/>`);
    let y = 50;
    const lines = 7 + Math.floor(rand() * 3);
    for (let i = 0; i < lines; i += 1) {
      const w = 150 + Math.floor(rand() * 66);
      parts.push(`<rect x="24" y="${y}" width="${w}" height="4" rx="2" fill="#c9cbd1"/>`);
      y += 11;
    }
    if (spec.figure) {
      parts.push(`<rect x="34" y="${y + 6}" width="${THUMB_W - 68}" height="62" rx="3" fill="${spec.tint}" fill-opacity="0.22" stroke="${spec.tint}" stroke-opacity="0.6"/>`);
      parts.push(`<path d="M44 ${y + 56} L84 ${y + 30} L118 ${y + 46} L158 ${y + 20} L196 ${y + 42}" fill="none" stroke="${spec.tint}" stroke-width="2.5"/>`);
      y += 78;
    }
    const rest = Math.floor((250 - y) / 11);
    for (let i = 0; i < rest; i += 1) {
      const w = 130 + Math.floor(rand() * 86);
      parts.push(`<rect x="24" y="${y}" width="${w}" height="4" rx="2" fill="#d2d4d9"/>`);
      y += 11;
    }
  } else {
    parts.push(`<rect x="24" y="60" width="90" height="4" rx="2" fill="#e4e5e8"/>`);
  }
  if (spec.footer !== null) {
    parts.push(
      `<text x="${THUMB_W / 2}" y="${THUMB_H * 0.95 + 4}" text-anchor="middle" font-family="Georgia, serif" font-size="12" fill="#444">${escapeXml(spec.footer)}</text>`,
    );
  }
  parts.push('</svg>');
  return `data:image/svg+xml,${encodeURIComponent(parts.join(''))}`;
}

export interface DemoSession {
  sources: SourceFile[];
  pages: PageRecord[];
}

export function buildDemoSession(): DemoSession {
  const order = shuffled(specs(), 20260);
  const splitAt = Math.ceil(order.length * 0.6);
  const groups = [order.slice(0, splitAt), order.slice(splitAt)];
  const names = ['chapter-notes.pdf', 'more-scans.pdf'];
  const sources: SourceFile[] = [];
  const pages: PageRecord[] = [];
  let inputIndex = 0;
  groups.forEach((group, fileIndex) => {
    const id = `demo-s${fileIndex}`;
    sources.push({
      id,
      name: names[fileIndex]!,
      kind: 'pdf',
      mimeType: 'application/pdf',
      size: 180_000 + group.length * 40_000,
      inputIndex: fileIndex,
      pageCount: group.length,
    });
    group.forEach((spec, sourceIndex) => {
      const evidence = evidenceFor(spec);
      pages.push({
        id: `demo-p${inputIndex}`,
        sourceFileId: id,
        sourceIndex,
        inputIndex,
        kind: 'pdf-page',
        label: `${names[fileIndex]} · p.${sourceIndex + 1}`,
        width: DEMO_PAGE_WIDTH,
        height: DEMO_PAGE_HEIGHT,
        thumbnail: { url: pageSvgDataUrl(spec), width: THUMB_W, height: THUMB_H },
        perceptualHash: hashFromSeed(spec.seed),
        evidence,
        candidates: extractCandidates(evidence).candidates,
        status: 'done',
      });
      inputIndex += 1;
    });
  });
  return { sources, pages };
}

/** `?demo`, `?demo=1`, `?demo=true` enable demo mode; `?demo=0|false` does not. */
export function isDemoRequested(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has('demo')) return false;
  const value = params.get('demo');
  return value === null || !['0', 'false', 'off', 'no'].includes(value.toLowerCase());
}
