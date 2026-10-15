import type { BandConfig, PageRegion, UserOverrides } from './types';

/** Header/footer bands examined for page numbers: top and bottom 15 % of the page. */
export const DEFAULT_BANDS: BandConfig = Object.freeze({ top: 0.15, bottom: 0.15 });

/** Perceptual hashes are 64-bit (16 hex chars). */
export const HASH_BITS = 64;

/** Hamming distance at or below which two page hashes are treated as the same scan. */
export const DEFAULT_DUPLICATE_HASH_THRESHOLD = 10;

/** Assignments below this confidence are flagged for review. */
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Adjusted score a candidate needs before it is assigned at all. */
export const DEFAULT_MIN_ACCEPT_SCORE = 0.35;

/** Largest roman numeral accepted as a page number (front matter rarely exceeds this). */
export const MAX_ROMAN = 100;

/** Largest arabic page number accepted. */
export const MAX_PAGE_VALUE = 9999;

export const PAGE_REGIONS: readonly PageRegion[] = Object.freeze([
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'body',
]);

/** Starting value for `UserOverrides` in UI state. */
export const EMPTY_OVERRIDES: UserOverrides = Object.freeze({
  numbers: Object.freeze({}),
  removed: Object.freeze([]) as readonly string[],
  rotations: Object.freeze({}),
  manualOrder: null,
});
