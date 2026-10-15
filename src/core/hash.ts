import { DEFAULT_DUPLICATE_HASH_THRESHOLD } from './constants';

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function normalizeHex(hash: string): string {
  const s = hash.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(s)) {
    throw new TypeError(`hammingDistance: not a hex string: "${hash}"`);
  }
  return s;
}

/**
 * Hamming distance between two perceptual hashes given as hex strings
 * (16 chars for the 64-bit hashes the pipeline produces). Shorter strings are
 * left-padded with zeros so differently-formatted hashes still compare.
 */
export function hammingDistance(a: string, b: string): number {
  let ha = normalizeHex(a);
  let hb = normalizeHex(b);
  const len = Math.max(ha.length, hb.length);
  ha = ha.padStart(len, '0');
  hb = hb.padStart(len, '0');
  let d = 0;
  for (let i = 0; i < len; i += 1) {
    const x = Number.parseInt(ha[i]!, 16) ^ Number.parseInt(hb[i]!, 16);
    d += POPCOUNT_NIBBLE[x]!;
  }
  return d;
}

/**
 * Whether two pages are the same scan. Returns `null` when either hash is missing
 * (the caller must treat the pair as "unknown", i.e. a conflict to check).
 */
export function isNearDuplicate(
  a: string | null | undefined,
  b: string | null | undefined,
  threshold: number = DEFAULT_DUPLICATE_HASH_THRESHOLD,
): boolean | null {
  if (!a || !b) return null;
  return hammingDistance(a, b) <= threshold;
}

/**
 * Reference dHash over an 9x8 greyscale sample (72 values, row-major): each bit is
 * `left pixel > right pixel`. The pipeline computes the greyscale sample from a canvas and
 * calls this so the hash format is defined in one place. Returns 16 lowercase hex chars.
 */
export function dHashFromGray(gray: ArrayLike<number>, width = 9, height = 8): string {
  if (gray.length < width * height) {
    throw new RangeError(`dHashFromGray: expected ${width * height} samples, got ${gray.length}`);
  }
  let hex = '';
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const bit = gray[y * width + x]! > gray[y * width + x + 1]! ? 1 : 0;
      nibble = (nibble << 1) | bit;
      bits += 1;
      if (bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  if (bits > 0) hex += (nibble << (4 - bits)).toString(16);
  return hex;
}
