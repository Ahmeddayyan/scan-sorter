/**
 * Scan Sorter core engine - pure TypeScript, no DOM.
 *
 * Pipeline usage:   extractCandidates(evidence) -> PageRecord.candidates
 * UI usage:         inferDocument(pages, { overrides }) -> InferenceResult (re-run on every change)
 * Export usage:     buildExportPlan(pages, result, overrides, sources) -> ExportPlan
 */
export type * from './types';

export {
  DEFAULT_BANDS,
  DEFAULT_DUPLICATE_HASH_THRESHOLD,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  DEFAULT_MIN_ACCEPT_SCORE,
  EMPTY_OVERRIDES,
  HASH_BITS,
  MAX_PAGE_VALUE,
  MAX_ROMAN,
  PAGE_REGIONS,
} from './constants';

export {
  bandRects,
  boxCenter,
  clampBox,
  isFooterRegion,
  isHeaderRegion,
  normalizeBandBox,
  normalizeBox,
  regionBand,
  regionOf,
  regionSide,
  unionBoxes,
  type BandRects,
} from './geometry';

export { looksRoman, parseRoman, toRoman } from './roman';

export {
  comparePageNumbers,
  formatPageNumber,
  pageNumber,
  pageNumberKey,
  parsePageNumberInput,
  samePageNumber,
} from './pageNumber';

export { dHashFromGray, hammingDistance, isNearDuplicate } from './hash';

export { confusableToDigits, digitVariants, type ConfusableResult } from './confusions';

export { buildLines, tokenize, type Line, type Segment, type Token } from './tokenize';

export { extractCandidates } from './candidates';

export { inferDocument } from './inference';

export { buildOrder, buildSlots } from './order';

export { buildReport, missingRanges, type ReportInput } from './report';

export { buildExportPlan, suggestExportFileName } from './exportPlan';
