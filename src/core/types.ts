/**
 * Shared types for Scan Sorter.
 *
 * This file is the contract between the three layers:
 *   - pipeline (browser I/O: files -> PageRecord + evidence)   src/pipeline
 *   - core     (pure TS: candidates -> inference -> report)    src/core
 *   - UI       (React state + components)                     src/state, src/components
 *
 * Everything here is plain JSON-serialisable data (no DOM types, no classes,
 * no Map/Set) so it can live in React state, be logged, and be unit-tested in Node.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Unique id of a page across the whole session (pipeline-generated, opaque). */
export type PageId = string;
/** Unique id of an input file across the whole session (pipeline-generated, opaque). */
export type SourceFileId = string;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Axis-aligned box in NORMALISED page coordinates.
 * Origin is the top-left corner of the upright page (as shown in the thumbnail),
 * x grows to the right, y grows DOWNWARDS, and all four values are fractions of
 * the page width / height in [0, 1].
 */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned rectangle in pixels (or PDF user units), y down. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Header/footer band heights as fractions of the page height. */
export interface BandConfig {
  /** Height of the top band, e.g. 0.15 = top 15 % of the page. */
  top: number;
  /** Height of the bottom band, e.g. 0.15 = bottom 15 % of the page. */
  bottom: number;
}

/** Which part(s) of a page were examined for text. */
export type BandId = 'top' | 'bottom' | 'full';

/** Coarse location of a text box on the page (3 columns x header/footer, plus body). */
export type PageRegion =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'body';

/** Extra clockwise rotation applied by the user, in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

// ---------------------------------------------------------------------------
// Source files and pages (pipeline output)
// ---------------------------------------------------------------------------

export type SourceFileKind = 'pdf' | 'image';

/** Metadata about one input file. The bytes themselves stay with the UI as a `File`. */
export interface SourceFile {
  id: SourceFileId;
  /** Original file name including extension, e.g. "lecture-notes.pdf". */
  name: string;
  kind: SourceFileKind;
  mimeType: string;
  /** Size in bytes. */
  size: number;
  /** 0-based position of this file in the user's input order (across all drops so far). */
  inputIndex: number;
  /** Number of pages (1 for images). `null` while a PDF is still being opened. */
  pageCount: number | null;
}

export type PageKind = 'pdf-page' | 'image';

export type PageStatus =
  /** Registered, thumbnail may still be rendering. */
  | 'pending'
  /** Text layer / OCR in progress. */
  | 'analyzing'
  /** Evidence and candidates are final. */
  | 'done'
  /** Could not be rendered or analysed; `error` says why. The page still exists. */
  | 'error';

export interface PageThumbnail {
  /** Object URL (`URL.createObjectURL`) or data URL of a small preview. */
  url: string;
  /** Pixel size of the thumbnail image. */
  width: number;
  height: number;
}

/** Where the words on a page came from. */
export type EvidenceSource =
  /** Digital PDF text layer (pdf.js getTextContent) - exact text, confidence 1. */
  | 'text-layer'
  /** tesseract.js OCR of the header/footer bands (or the full page as fallback). */
  | 'ocr'
  /** Nothing was analysed (yet) or nothing was found. */
  | 'none';

/** One positioned word / text run. */
export interface TextItem {
  /** Raw text. May contain spaces for text-layer runs ("Page 12 of 40"); core tokenises it. */
  text: string;
  /** Normalised box on the upright page. */
  box: NormBox;
  /** 0..1. Text-layer items are 1. OCR items: tesseract word confidence / 100. */
  confidence: number;
}

export interface PageEvidence {
  source: EvidenceSource;
  /** Which bands were examined (`['top','bottom']` for band OCR, `['full']` for a text layer or full-page OCR). */
  bands: BandId[];
  /** All positioned words found in the examined bands. Empty when nothing was found. */
  items: TextItem[];
  /** True when the source PDF page has a usable text layer (even if it contained no number). */
  hasTextLayer: boolean;
}

/**
 * One page of the session. Produced by the pipeline, never mutated by the UI:
 * all user edits live in {@link UserOverrides}.
 */
export interface PageRecord {
  id: PageId;
  sourceFileId: SourceFileId;
  /** 0-based page index inside the source file (always 0 for images). */
  sourceIndex: number;
  /** 0-based global position in input order (file order, then page order). Unique per session. */
  inputIndex: number;
  kind: PageKind;
  /** Short human label for the UI, e.g. "notes.pdf · p.3" or "IMG_0042.jpg". */
  label: string;
  /** Natural page size (pixels for images, PDF points at 72 dpi for PDF pages), after intrinsic /Rotate. */
  width: number;
  height: number;
  /** Small preview; `null` until rendered. */
  thumbnail: PageThumbnail | null;
  /**
   * Perceptual hash (64-bit dHash) as a 16-char lowercase hex string, computed from a
   * downscaled greyscale render. `null` when unavailable. Used to tell duplicate scans
   * from genuinely different pages that read the same number.
   */
  perceptualHash: string | null;
  evidence: PageEvidence;
  /** Output of `extractCandidates(evidence)` - the pipeline computes this once per page. */
  candidates: PageNumberCandidate[];
  status: PageStatus;
  /** Error message when `status === 'error'`. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Page numbers and candidates (core)
// ---------------------------------------------------------------------------

export type NumberingStyle = 'arabic' | 'roman';

/** A page number: integer value plus numbering style (roman front matter sorts before arabic). */
export interface PageNumber {
  value: number;
  style: NumberingStyle;
}

export type CandidatePattern =
  /** Bare integer alone in its segment: "12". */
  | 'bare'
  /** "Page 12", "p. 12", "pg 12", "Seite 12". */
  | 'page-word'
  /** "Page 12 of 40". */
  | 'page-of'
  /** "12 / 40", "12 of 40", "12/40". */
  | 'slash-total'
  /** "- 12 -", "– 12 –". */
  | 'dashed'
  /** "[12]", "(12)". */
  | 'bracketed'
  /** Roman numeral: "iv", "xii". */
  | 'roman'
  /** Integer at the start or end of a longer line (running header "17  Introduction"). */
  | 'edge-of-text';

export interface PageNumberCandidate {
  number: PageNumber;
  /** Document total from "of M" / "N / M" patterns, when present on this candidate. */
  total: number | null;
  pattern: CandidatePattern;
  /** Text of the token(s) that produced the number, as read ("1O" for a misread). */
  rawText: string;
  /** Text of the whole line segment the number sits in (for tooltips / debugging). */
  segmentText: string;
  /** Box of the matched token(s). */
  box: NormBox;
  region: PageRegion;
  /** True when the segment contains nothing but the number pattern. */
  isolated: boolean;
  /** True when OCR-confusable letters (O, l, S, ...) were mapped to digits to form the number. */
  misread: boolean;
  /** 0..1 OCR/text confidence of the underlying token(s). */
  textConfidence: number;
  /** Local (single-page) score in (0, 1]. Cross-page consistency is applied in inference. */
  score: number;
}

export type RejectReason =
  | 'labelled' // "Chapter 3", "Figure 4", "Section 2"
  | 'year' // 1900..2100 without a page pattern
  | 'date' // part of a date
  | 'copyright' // near a (c) / copyright
  | 'number-cluster' // phone numbers, ISBNs, long digit runs
  | 'unit' // "12 %", "$12", "12 pt"
  | 'superscript' // footnote marker
  | 'embedded' // integer in the middle of running text
  | 'body-not-isolated' // body-region number that is not alone on its line
  | 'zero'
  | 'too-large'
  | 'roman-too-large'
  | 'total-only'; // the "40" in "12 of 40"

export interface RejectedCandidate {
  rawText: string;
  segmentText: string;
  box: NormBox;
  region: PageRegion;
  reason: RejectReason;
}

export interface ExtractionResult {
  /** Accepted candidates, best first. */
  candidates: PageNumberCandidate[];
  /** Everything numeric that was seen and rejected, for debugging and "why?" tooltips. */
  rejected: RejectedCandidate[];
}

export interface ExtractionOptions {
  /** Band geometry used for region classification. Default {@link DEFAULT_BANDS}. */
  bands?: BandConfig;
  /** Largest roman numeral accepted as a page number. Default 100. */
  maxRoman?: number;
  /** Largest arabic value accepted as a page number. Default 9999. */
  maxValue?: number;
}

// ---------------------------------------------------------------------------
// User overrides (UI state consumed by core)
// ---------------------------------------------------------------------------

/**
 * Everything the user changed. Kept separate from PageRecord so pipeline data stays
 * immutable and "reset all edits" is trivial. All fields are required so reducers
 * can spread/replace them without null checks; use {@link EMPTY_OVERRIDES} as the start value.
 */
export interface UserOverrides {
  /**
   * Manual page numbers. A value wins over any detection with confidence 1.
   * `null` means "the user says this page has no number" (forces unnumbered).
   */
  numbers: Readonly<Record<PageId, PageNumber | null>>;
  /** Pages the user removed (excluded from order, report and export; still in state for undo). */
  removed: readonly PageId[];
  /** Extra clockwise rotation per page; absent = 0. Only affects export and thumbnails. */
  rotations: Readonly<Record<PageId, Rotation>>;
  /**
   * When non-null the user has drag-reordered: this exact order is used (pages missing
   * from it are appended in input order) and automatic re-sorting is suspended. Set back
   * to `null` to return to automatic ordering.
   */
  manualOrder: readonly PageId[] | null;
}

// ---------------------------------------------------------------------------
// Inference result (core output, UI input)
// ---------------------------------------------------------------------------

export type AssignmentSource = 'manual' | 'text-layer' | 'ocr' | 'none';

export type AssignmentFlag =
  /** Confidence below the low-confidence threshold - show an amber badge. */
  | 'low-confidence'
  /** The read value was out of range and a single-character OCR confusion fixed it (e.g. "77" -> 17). */
  | 'misread-corrected'
  /** The best candidate collided with another page; a weaker candidate on this page was used instead. */
  | 'alternative-chosen'
  /** The assigned number falls outside the dominant range of the document. */
  | 'out-of-range'
  /** Another page has the same number. */
  | 'duplicate'
  /** No number assigned. */
  | 'unnumbered'
  /** Number was set by the user. */
  | 'manual';

export interface PageAssignment {
  pageId: PageId;
  /** Assigned number, or `null` when unnumbered. */
  number: PageNumber | null;
  /** "of M" total read on this page, if any. */
  total: number | null;
  /** 0..1 (1 for manual). */
  confidence: number;
  source: AssignmentSource;
  /** Short human-readable explanation, e.g. "bottom-center, consistent with 38 other pages". */
  reason: string;
  flags: AssignmentFlag[];
  /** The candidate the number came from, if any (for highlighting the box on the thumbnail). */
  candidate: PageNumberCandidate | null;
  /** Alternative numbers worth offering in the correction UI (misread variants, runner-ups). */
  suggestions: PageNumber[];
}

export interface LayoutProfile {
  /** Region(s) where page numbers were found on most pages (1, or 2 when alternating). */
  dominantRegions: PageRegion[];
  /** Book-scan style: numbers alternate between left and right corners on odd/even pages. */
  alternating: boolean;
  /** When alternating: the side odd numbers sit on. */
  oddSide: 'left' | 'right' | null;
  /** Fraction (0..1) of confidently numbered pages whose number sits in each region. */
  regionShare: Record<PageRegion, number>;
}

export interface SequenceInfo {
  style: NumberingStyle;
  min: number;
  max: number;
  /** Pages carrying a number of this style. */
  count: number;
  /** Document total from "of M" patterns (arabic only), when detected. */
  total: number | null;
  /** First number is > 1 and no total is known - probably an excerpt, reported as a soft note. */
  startsAboveOne: boolean;
}

/** Inclusive range of missing page numbers of one style. */
export interface MissingRange {
  style: NumberingStyle;
  from: number;
  to: number;
  count: number;
}

export type DuplicateKind =
  /** All pages in the group are near-identical images: the same sheet was scanned twice. */
  | 'duplicate-scan'
  /** Different-looking pages read the same number: at least one of them is misread. */
  | 'conflict';

export interface DuplicatePair {
  a: PageId;
  b: PageId;
  /** Hamming distance between perceptual hashes (0..64), or `null` if a hash is missing. */
  distance: number | null;
}

export interface DuplicateIssue {
  number: PageNumber;
  /** All pages carrying this number, in display order. */
  pageIds: PageId[];
  kind: DuplicateKind;
  /** Pages that are near-identical to another page in the group and can be removed safely. */
  safeToRemove: PageId[];
  /** The page to keep for this number (highest confidence, then first in input). */
  keep: PageId;
  pairs: DuplicatePair[];
}

export interface LowConfidenceEntry {
  pageId: PageId;
  number: PageNumber | null;
  confidence: number;
  reason: string;
}

export type ReportNoteKind =
  /** Numbering starts above 1 and no total is known: leading pages are NOT reported missing. */
  | 'starts-above-one'
  /** "of M" totals found; gaps are computed against [1..M]. */
  | 'total-detected'
  /** The last numbered page is below the detected total. */
  | 'trailing-missing'
  /** Manual order is active; automatic sorting is suspended. */
  | 'manual-order'
  /** No page numbers were found at all. */
  | 'no-numbers-found'
  /** Roman front matter + arabic body were both detected. */
  | 'front-matter';

export interface ReportNote {
  kind: ReportNoteKind;
  message: string;
  style?: NumberingStyle;
  value?: number;
}

export interface DocumentReport {
  missing: MissingRange[];
  duplicates: DuplicateIssue[];
  /** Pages with no number, in display order (includes user-forced unnumbered pages). */
  unnumbered: PageId[];
  lowConfidence: LowConfidenceEntry[];
  notes: ReportNote[];
  summary: {
    /** Active (non-removed) pages. */
    pages: number;
    numbered: number;
    unnumbered: number;
    /** Total count of missing numbers (sum of ranges). */
    missing: number;
    duplicates: number;
    lowConfidence: number;
    removed: number;
  };
}

/** One tile of the review grid. Gap tiles are placeholders for missing numbers. */
export type GridSlot =
  | { kind: 'page'; id: string; pageId: PageId }
  | { kind: 'gap'; id: string; from: PageNumber; to: PageNumber; count: number };

export interface InferenceResult {
  /** Display/export order of active page ids. */
  order: PageId[];
  /** One assignment per active page (removed pages are absent). */
  assignments: Record<PageId, PageAssignment>;
  /** Grid tiles in display order: pages plus gap placeholders (no gap tiles in manual-order mode). */
  slots: GridSlot[];
  report: DocumentReport;
  /** Per-style summary of the numbering found. */
  sequences: SequenceInfo[];
  /** Where numbers sit on the page; `null` when fewer than 3 pages are confidently numbered. */
  layout: LayoutProfile | null;
  /** Document total from "of M" patterns, when detected. */
  detectedTotal: number | null;
  /** True when `overrides.manualOrder` was applied. */
  manualOrder: boolean;
}

export interface InferenceOptions {
  overrides?: UserOverrides;
  /** Max hamming distance (0..64) for two hashes to count as the same scan. Default 10. */
  duplicateHashThreshold?: number;
  /** Assignments below this confidence are flagged. Default 0.6. */
  lowConfidenceThreshold?: number;
  /** Adjusted score a candidate needs to be assigned at all. Default 0.35. */
  minAcceptScore?: number;
  /** Try single-character OCR confusion fixes for out-of-range / conflicting reads. Default true. */
  correctMisreads?: boolean;
}

// ---------------------------------------------------------------------------
// Pipeline progress (pipeline -> UI)
// ---------------------------------------------------------------------------

export type PipelinePhase =
  | 'idle'
  /** Opening files, counting pages, rendering thumbnails. */
  | 'loading'
  /** Text-layer extraction / OCR running. */
  | 'analyzing'
  | 'done'
  | 'cancelled'
  | 'error';

export interface PipelineProgress {
  phase: PipelinePhase;
  /** Total pages across all files, `null` until every file has been opened. */
  totalPages: number | null;
  /** Pages that have a thumbnail. */
  renderedPages: number;
  /** Pages whose evidence is final (`status` done or error). */
  analyzedPages: number;
  /** Pages that went through OCR (as opposed to the text layer). */
  ocrPages: number;
  /** Name of the file being worked on, if any. */
  currentFile: string | null;
  /** Free-form status for the UI ("Loading OCR engine…"). */
  message: string | null;
}

export interface PipelineError {
  sourceFileId: SourceFileId | null;
  fileName: string | null;
  pageId: PageId | null;
  message: string;
}

// ---------------------------------------------------------------------------
// Export plan (core -> export)
// ---------------------------------------------------------------------------

export interface ExportPage {
  pageId: PageId;
  sourceFileId: SourceFileId;
  sourceIndex: number;
  kind: PageKind;
  rotation: Rotation;
  /** Final number (for optional bookmarks/metadata). */
  number: PageNumber | null;
}

export interface ExportPlan {
  /** Pages in final order, removed pages excluded. */
  pages: ExportPage[];
  /** Suggested output name, e.g. "lecture-notes-sorted.pdf". */
  fileName: string;
}
