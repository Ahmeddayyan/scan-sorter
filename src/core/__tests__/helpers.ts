import { extractCandidates } from '../candidates';
import type { EvidenceSource, PageRecord, PageRegion, PageStatus, TextItem } from '../types';

/** Where to put a piece of text: a named region or an explicit centre in normalised coords. */
export type Place = PageRegion | { x: number; y: number };

export interface PlacedText {
  text: string;
  at: Place;
  /** Emit one TextItem per word (OCR-like) instead of one run (text-layer-like). */
  split?: boolean;
  confidence?: number;
  /** Glyph height as a fraction of page height. Default 0.012 (~9 pt on Letter). */
  h?: number;
  /** Character width as a fraction of page width. Default 0.0075. */
  cw?: number;
}

const REGION_Y: Record<'top' | 'bottom' | 'body', number> = { top: 0.05, bottom: 0.95, body: 0.5 };

function placement(at: Place, totalWidth: number): { x0: number; cy: number } {
  if (typeof at !== 'string') return { x0: at.x - totalWidth / 2, cy: at.y };
  const band = at === 'body' ? 'body' : at.startsWith('top') ? 'top' : 'bottom';
  const cy = REGION_Y[band];
  if (at.endsWith('-left')) return { x0: 0.06, cy };
  if (at.endsWith('-right')) return { x0: 0.94 - totalWidth, cy };
  return { x0: 0.5 - totalWidth / 2, cy };
}

/** Build TextItems for one placed string. */
export function placeText(spec: PlacedText): TextItem[] {
  const h = spec.h ?? 0.012;
  const cw = spec.cw ?? 0.0075;
  const confidence = spec.confidence ?? 1;
  const totalWidth = spec.text.length * cw;
  const { x0, cy } = placement(spec.at, totalWidth);
  const y = cy - h / 2;
  if (!spec.split) return [{ text: spec.text, box: { x: x0, y, w: totalWidth, h }, confidence }];
  const items: TextItem[] = [];
  let offset = 0;
  for (const part of spec.text.split(/\s+/)) {
    const start = spec.text.indexOf(part, offset);
    offset = start + part.length;
    items.push({ text: part, box: { x: x0 + start * cw, y, w: part.length * cw, h }, confidence });
  }
  return items;
}

export interface PageSpec {
  id?: string;
  inputIndex?: number;
  texts?: PlacedText[];
  hash?: string | null;
  source?: EvidenceSource;
  sourceFileId?: string;
  sourceIndex?: number;
  status?: PageStatus;
}

export function makePage(spec: PageSpec, index: number): PageRecord {
  const texts = spec.texts ?? [];
  const items = texts.flatMap(placeText);
  const source: EvidenceSource =
    spec.source ?? (items.length === 0 ? 'none' : texts.some((t) => (t.confidence ?? 1) < 1) ? 'ocr' : 'text-layer');
  const evidence = {
    source,
    bands: source === 'ocr' ? (['top', 'bottom'] as const).slice() : (['full'] as const).slice(),
    items,
    hasTextLayer: source === 'text-layer',
  };
  const id = spec.id ?? `p${index}`;
  return {
    id,
    sourceFileId: spec.sourceFileId ?? 'f0',
    sourceIndex: spec.sourceIndex ?? index,
    inputIndex: spec.inputIndex ?? index,
    kind: 'pdf-page',
    label: `scan.pdf · p.${(spec.sourceIndex ?? index) + 1}`,
    width: 612,
    height: 792,
    thumbnail: null,
    perceptualHash: spec.hash === undefined ? hashFor(index) : spec.hash,
    evidence,
    candidates: extractCandidates(evidence).candidates,
    status: spec.status ?? 'done',
  };
}

export function makePages(specs: readonly PageSpec[]): PageRecord[] {
  return specs.map((s, i) => makePage(s, i));
}

/** Convenience: a page whose only text is `label` (number string) at `region`. */
export function numberedPage(label: string | null, region: PageRegion = 'bottom-center', extra: Partial<PageSpec> = {}): PageSpec {
  return { ...extra, texts: [...(label === null ? [] : [{ text: label, at: region }]), ...(extra.texts ?? [])] };
}

/** Pages whose footers carry the given labels (null = blank page), in input order. */
export function footerPages(labels: readonly (string | null)[], region: PageRegion = 'bottom-center'): PageRecord[] {
  return makePages(labels.map((l) => numberedPage(l, region)));
}

/** Deterministic pseudo-random 64-bit hash; different seeds are ~32 bits apart. */
export function hashFor(seed: number): string {
  let x = (seed + 1) * 2654435761 >>> 0;
  let hex = '';
  for (let i = 0; i < 16; i += 1) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    hex += (x & 0xf).toString(16);
  }
  return hex;
}

/** Flip the lowest `bits` bits of a hex hash (bits <= 64). */
export function flipBits(hash: string, bits: number): string {
  const chars = hash.split('');
  let remaining = bits;
  for (let i = chars.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const n = Math.min(4, remaining);
    const mask = (1 << n) - 1;
    chars[i] = (Number.parseInt(chars[i]!, 16) ^ mask).toString(16);
    remaining -= n;
  }
  return chars.join('');
}

/** Fisher-Yates with a fixed seed. */
export function shuffle<T>(items: readonly T[], seed = 42): T[] {
  const out = [...items];
  let s = seed;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
