# Scan Sorter – Architecture & Contracts

> Put shuffled scans back in order. Find missing pages. Nothing leaves your device.

100 % client-side: no server, no uploads, **no third-party network requests at runtime**
(OCR and pdf.js assets are self-hosted), works offline once loaded.

Stack (fixed): Vite 8 + React 19 + TypeScript 6 (strict), `pdfjs-dist` 6.4, `tesseract.js` 7,
`pdf-lib`, `@dnd-kit/{core,sortable,utilities}`, Vitest 5, oxlint (the Vite template linter),
Playwright (`@playwright/test`, dev-only, drives the locally installed Microsoft Edge).
Plain CSS with design tokens. State: `useReducer` + context. **Do not add runtime dependencies.**

---

## 1. Folder structure

```
scan-sorter/
├─ docs/ARCHITECTURE.md          this file;  docs/USER_GUIDE.md  plain-language guide
├─ LICENSE                       MIT
├─ scripts/
│  ├─ copy-assets.mjs            copies tesseract + pdf.js assets node_modules -> public/ (postinstall/predev/prebuild)
│  └─ make-fixtures.mjs          generates test-fixtures/generated/* (npm run fixtures): text-layer PDFs,
│                                an image-only PDF and PNG/JPEG(EXIF)/WebP "photos" (via @napi-rs/canvas), notes.txt
├─ public/
│  ├─ favicon.svg
│  ├─ tesseract/                 (gitignored, generated)  worker.min.js, core/*.wasm.js, lang/eng.traineddata.gz
│  └─ pdfjs/                     (gitignored, generated)  wasm/, standard_fonts/, cmaps/, iccs/
├─ test-fixtures/                README + generated/ (gitignored)
├─ e2e/                          Playwright suite (section 10) + playwright.config.ts, tsconfig.e2e.json
└─ src/
   ├─ core/                      PURE TS, NO DOM: the contract and the engine (section 3-4). 99 unit tests.
   │  ├─ types.ts                every shared type
   │  ├─ index.ts                barrel – import everything from '../core'
   │  ├─ constants.ts  geometry.ts  roman.ts  pageNumber.ts  hash.ts  confusions.ts
   │  ├─ tokenize.ts   candidates.ts (extractCandidates)   inference.ts (inferDocument)
   │  └─ order.ts      report.ts     exportPlan.ts
   ├─ pipeline/                  Browser I/O (section 5): process.ts (orchestrator), pdf.ts, image.ts,
   │                             ocr.ts, analyze.ts, canvas.ts, registry.ts, helpers.ts (pure, tested)
   ├─ export/                    pdf-lib export (section 6): index.ts + helpers.ts (pure, tested)
   ├─ state/                     reducer.ts, overrides.ts, derive.ts (pure, tested), store.tsx, demo.ts, theme.ts
   ├─ components/                React components + colocated CSS
   ├─ styles/                    tokens.css (design tokens, light/dark), base.css (reset, buttons, modal)
   └─ App.tsx, main.tsx
```

Conventions that still hold: pipeline/export/UI import only from `'../core'` (the barrel), never
from deep core files; only plain data crosses module boundaries.

---

## 2. Data flow

```
 User drops File[]  ──►  UI dispatch  ──►  pipeline.processFiles(files, callbacks, { signal })
                                               │
            onSource(SourceFile, File)  ◄──────┤  per file: open PDF (pdf.js) / decode image
            onPage(PageRecord 'pending') ◄─────┤  per page: thumbnail (object URL) + dHash
            onPage(PageRecord 'done')   ◄──────┤  per page: text layer | OCR bands  ─► core.extractCandidates
            onProgress(PipelineProgress)◄──────┘
                 │
   UI reducer stores pages by id (upsert) + UserOverrides
                 │
   core.inferDocument(pages, { overrides })  ──►  InferenceResult { order, assignments, slots, report, ... }
                 │                                   (re-run on every page update / user edit – it is fast)
   Review grid renders result.slots (page tiles + gap tiles), badges from assignments, warnings from report
                 │
   Export: core.buildExportPlan(pages, result, overrides, sources) ─► export.exportSortedPdf({ plan, sources })
           ─► export.downloadExport(result)       (pdf-lib; original PDF pages copied losslessly)
```

Only plain, JSON-serialisable data crosses module boundaries (no classes, no Map/Set in state).
`File` objects live in UI state next to `SourceFile` metadata and are handed to export.

---

## 3. Core types (src/core/types.ts) – summary

Read the file; it is documented line by line. Key shapes:

| Type | Purpose |
|---|---|
| `SourceFile { id, name, kind:'pdf'\|'image', mimeType, size, inputIndex, pageCount }` | input file metadata (bytes stay in a `File`) |
| `PageRecord { id, sourceFileId, sourceIndex, inputIndex, kind, label, width, height, thumbnail, perceptualHash, evidence, candidates, status, error? }` | one page; **immutable pipeline output** |
| `PageEvidence { source:'text-layer'\|'ocr'\|'none', bands, items: TextItem[], hasTextLayer }` | positioned words |
| `TextItem { text, box: NormBox, confidence 0..1 }` | `NormBox {x,y,w,h}` normalised to the upright page, y DOWN |
| `PageNumber { value, style:'arabic'\|'roman' }` | roman sorts before arabic |
| `PageNumberCandidate { number, total, pattern, rawText, segmentText, box, region, isolated, misread, textConfidence, score }` | output of `extractCandidates` |
| `UserOverrides { numbers: Record<PageId, PageNumber\|null>, removed: PageId[], rotations: Record<PageId, Rotation>, manualOrder: PageId[]\|null }` | **all user edits**; start from `EMPTY_OVERRIDES` |
| `InferenceResult { order, assignments, slots, report, sequences, layout, detectedTotal, manualOrder }` | what the UI renders |
| `PageAssignment { pageId, number, total, confidence, source, reason, flags, candidate, suggestions }` | per page |
| `GridSlot = {kind:'page', id, pageId} \| {kind:'gap', id, from, to, count}` | grid tiles incl. "Page 17 missing" placeholders |
| `DocumentReport { missing: MissingRange[], duplicates: DuplicateIssue[], unnumbered, lowConfidence, notes, summary }` | warnings panel |
| `DuplicateIssue { number, pageIds, kind:'duplicate-scan'\|'conflict', safeToRemove, keep, pairs }` | "remove duplicate scans" uses `safeToRemove` |
| `PipelineProgress`, `PipelineError` | status bar |
| `ExportPlan { pages: ExportPage[], fileName }`, `ExportPage { pageId, sourceFileId, sourceIndex, kind, rotation, number }` | export input |

Coordinate convention: **every box is normalised to the upright page as shown in the thumbnail**
(after the PDF's intrinsic `/Rotate`, before any user rotation), origin top-left, y grows down.

---

## 4. Core API (src/core/index.ts)

```ts
// Extraction (pipeline calls this once per page)
extractCandidates(evidence: PageEvidence, options?: ExtractionOptions): ExtractionResult
   // ExtractionResult { candidates: PageNumberCandidate[] /* best first */, rejected: RejectedCandidate[] }

// Inference (UI calls this after every page update and every edit)
inferDocument(pages: readonly PageRecord[], options?: InferenceOptions): InferenceResult
   // InferenceOptions { overrides?, duplicateHashThreshold?=10, lowConfidenceThreshold?=0.6,
   //                    minAcceptScore?=0.35, correctMisreads?=true }

// Export plan
buildExportPlan(pages, result, overrides, sources): ExportPlan
suggestExportFileName(sources): string            // "<first file base name>-sorted.pdf"

// Geometry helpers (pipeline)
bandRects(pageWidth, pageHeight, bands = DEFAULT_BANDS): { top: PixelRect; bottom: PixelRect }
normalizeBox(rect: PixelRect, pageWidth, pageHeight): NormBox
normalizeBandBox(rectInCrop, band, page:{width,height}, crop?:{width,height}): NormBox
regionOf(box, bands?): PageRegion

// Hashing (pipeline)
dHashFromGray(gray: ArrayLike<number>, width = 9, height = 8): string   // 16 hex chars
hammingDistance(a: string, b: string): number
isNearDuplicate(a, b, threshold = 10): boolean | null

// Numbers (UI)
parsePageNumberInput(text): PageNumber | null      // "17", "iv", "IV"; null for junk
formatPageNumber(n): string                        // "17" / "iv"
comparePageNumbers(a, b), samePageNumber(a, b), pageNumberKey(n)

// Lower-level (exported for debugging/tests): tokenize, buildLines, buildOrder, buildSlots,
// buildReport, missingRanges, parseRoman, toRoman, confusableToDigits, digitVariants
// Constants: DEFAULT_BANDS {top:.15,bottom:.15}, EMPTY_OVERRIDES, PAGE_REGIONS, MAX_ROMAN=100, ...
```

### How inference works (so you can explain badges/warnings in the UI)
1. Manual overrides are fixed (`source:'manual'`, confidence 1; `null` = forced unnumbered).
2. Local best candidate per page → **layout profile** (dominant region(s); book-scan odd/even
   alternation with `oddSide`) and the **dominant range** per style (interval maximising summed
   score minus a per-gap penalty; wild outliers such as "77" in a 1..40 document fall outside),
   plus the **"of M" total** by weighted vote.
3. Every candidate is re-scored: `local × region × range × parity × total`; best ≥ `minAcceptScore`
   wins, else the page is unnumbered.
4. Gap filling: an unnumbered page gets a weak in-range candidate, or a **single-character OCR
   confusion variant** (1↔7, 5↔S, 0↔O, …) when exactly one such value fills a gap
   (`flags: ['misread-corrected','low-confidence']`, confidence ≤ 0.5). Ambiguous fixes go to
   `assignment.suggestions`. Pages that collide with a *different-looking* page (hash distance >
   threshold) try another candidate on the page (`'alternative-chosen'`) or a variant; otherwise the
   report lists a `'conflict'`. Near-identical pages keep the same number → `'duplicate-scan'`.
5. Order: roman first, then arabic by value; **unnumbered pages stay right after the page that
   preceded them in the input** (leading ones first). `manualOrder` replaces this entirely.
   Slots insert gap tiles between non-consecutive numbers; leading gaps `[1..min-1]` only when a
   total is known (otherwise a soft `starts-above-one` note); trailing gaps `[max+1..total]`.

Deterministic; ~10 ms for 300 pages.

---

## 5. Pipeline contract (src/pipeline/index.ts)

```ts
processFiles(files: readonly File[], callbacks: ProcessFilesCallbacks, options?: ProcessFilesOptions): Promise<ProcessFilesResult>
reanalyzePages(pageIds, callbacks, options?): Promise<PageRecord[]>
renderPagePreview(pageId, maxSize, rotation?): Promise<string /* object URL */>
releasePages(pageIds): void
shutdownPipeline(): Promise<void>

interface ProcessFilesCallbacks {
  onSource: (source: SourceFile, file: File) => void;
  onPage: (page: PageRecord) => void;          // UPSERT by id; called ≥ 2× per page (pending → done/error)
  onProgress: (progress: PipelineProgress) => void;
  onError?: (error: PipelineError) => void;    // non-fatal, per file/page
}
interface ProcessFilesOptions { signal?; ocr?: 'auto'|'always'|'never'; fallbackFullPageOcr?; bands?;
                                thumbnailSize?; ocrWorkers?; startInputIndex?; startSourceIndex? }
interface ProcessFilesResult { sources; pages; errors; cancelled }
```

Behaviour (as implemented in `pipeline/process.ts`):
- Input order = file order, then page order → `PageRecord.inputIndex` is unique and increasing
  across the whole session (`startInputIndex` continues numbering when more files are dropped).
- Ids: unique for the tab lifetime (module counters), e.g. `s3` and `s3-p12`. Never reused.
- `onSource` fires once a PDF has been **opened** (so `pageCount` is final). A PDF that cannot be
  opened (corrupt, encrypted) is **not** registered at all: the UI only gets `onError`.
- The `'pending'` record is emitted as soon as the thumbnail exists so the grid fills
  progressively; `'done'` carries `evidence` + `candidates = extractCandidates(evidence).candidates`.
  On failure the record becomes `'error'` with `error` text, empty evidence (`source:'none'`) and
  `candidates: []`. If the OCR engine itself fails to load, every page that needed OCR becomes
  `'error'` and there is one extra `onError` without a page id.
- Concurrency: one render lane (thumbnail + dHash + text layer, one page at a time) feeds a
  bounded queue (capacity = 2 × workers) of band crops; N consumers (= tesseract workers) run OCR.
  Full-page bitmaps never outlive the render call that produced them.
- Progress: `renderedPages`/`analyzedPages`/`ocrPages` counters, `totalPages` once all files are
  opened, `message` mirrors tesseract's status while the engine loads.
- Cancel: `signal.aborted` is checked between pages and before each OCR job; queued crops are
  discarded, the scheduler is terminated, and the call resolves with `cancelled: true`. Pages
  already emitted remain valid; the UI marks still-pending ones as `error: 'Not read (stopped early)'`.
  Measured cancel latency in Edge: ~0.3 s.
- Memory: only thumbnails (JPEG blob URLs, ≤ 240 px) and the queued band PNGs are retained; pdf.js
  documents are `destroy()`ed when their last page has been analysed (re-opened from the `File`
  for previews, LRU of 2). 240 pages run comfortably.
- Heavy libraries are loaded with dynamic `import()` (`pdfjs-dist`, `tesseract.js`, `pdf-lib`);
  Vite pre-bundles them in dev (`optimizeDeps.include`) so their discovery does not reload the page.
- **One scheduler is shared across `processFiles` calls.** Two concurrent calls would share it and
  a cancel in one terminates both; the UI therefore runs one batch at a time and queues further drops.

### 5.1 pdf.js setup (Vite) – pdfjs-dist 6.4

```ts
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';   // same-origin, fingerprinted by Vite (verified in e2e)
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const base = import.meta.env.BASE_URL;                                  // '/' by default
const task = pdfjs.getDocument({
  data: new Uint8Array(await file.arrayBuffer()),
  wasmUrl: `${base}pdfjs/wasm/`,                  // JBIG2 / JPX / qcms decoders – scanned PDFs need these
  standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
  cMapUrl: `${base}pdfjs/cmaps/`, cMapPacked: true,
  iccUrl: `${base}pdfjs/iccs/`,
});
const doc = await task.promise;
// ... later: await doc.loadingTask.destroy();     // this is how a document is closed in 6.x
```
(These directories are copied by `scripts/copy-assets.mjs`; all URLs include the trailing slash.)

Deviations from the original plan forced by the 6.4 API:
- `isEvalSupported` no longer exists as a `getDocument` option (it is simply not passed).
- `PageViewport.convertToViewportRectangle` is gone; the text-layer mapping converts the two
  corners with `convertToViewportPoint` (`pipeline/pdf.ts` → `extractTextLayer`, pure mapping in
  `helpers.ts` → `mapTextContentItems`, tested against `/Rotate 90`).
- Documents are closed with `doc.loadingTask.destroy()` (there is no `doc.destroy()`).
- `page.render()` needs the `canvas` itself in 6.x, not only `canvasContext`; rendering goes to an
  `OffscreenCanvas` when available (`pipeline/canvas.ts`), `<canvas>` otherwise. Verified in Edge.

Per page: `const page = await doc.getPage(i + 1); const vp = page.getViewport({ scale });`
`vp.width/height` already include the page's intrinsic `/Rotate`, which is the "upright page" of
the coordinate convention. Thumbnail: scale so the longest side is `thumbnailSize`, render to a
canvas, encode as JPEG 0.8 → `URL.createObjectURL`. `width/height` of the PageRecord = viewport
size at scale 1.

Text layer → `TextItem[]`: every non-blank `str` item; box = `[transform[4], transform[5]]`
(baseline-left, PDF user space) to `+width/+height`, both corners mapped through the scale-1
viewport (handles `/Rotate`), normalised with `normalizeBox`. `hasTextLayer = items.length > 0`.
Decide OCR: in `'auto'` mode, OCR when `hasTextLayer` is false **or** when `extractCandidates` on
the text layer yields no candidate outside the body region (some "digital" PDFs have an empty or
garbage text layer, and `unnumbered.pdf` has text but no number). The text-layer result is kept as
a fallback in case OCR fails or finds nothing. Verified against `test-fixtures/generated/*.pdf`
both in Node (`pipeline/__tests__/fixtures.test.ts`) and in Edge (`e2e/files.spec.ts`).

Images: `createImageBitmap(file, { imageOrientation: 'from-image' })` (respects EXIF – verified
with a JPEG stored sideways + orientation 6), drawn to a canvas for the thumbnail and the band
crops; `width/height` = bitmap size; `kind: 'image'`, `sourceIndex: 0`, `pageCount: 1`. Bitmaps
are closed after the crops are rendered and re-decoded on demand.

### 5.2 Perceptual hash
Draw the thumbnail (or page canvas) onto a 9×8 canvas (`ctx.drawImage(src, 0, 0, 9, 8)`), read
`getImageData`, luma = `0.299R + 0.587G + 0.114B` per pixel (72 values, row-major) →
`perceptualHash = dHashFromGray(gray)`. Near-identical scans have distance ≤ 10 (`DEFAULT_DUPLICATE_HASH_THRESHOLD`).

### 5.3 OCR with tesseract.js (self-hosted)

Assets (copied by `scripts/copy-assets.mjs`, served from the app origin, gitignored):

| URL (relative to `BASE_URL`) | Source in node_modules | Size |
|---|---|---|
| `tesseract/worker.min.js` | `tesseract.js/dist/worker.min.js` | 111 KB |
| `tesseract/core/tesseract-core-lstm.wasm.js` | `tesseract.js-core/` | 3.9 MB (wasm embedded, base64) |
| `tesseract/core/tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core/` | 3.9 MB |
| `tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js` | `tesseract.js-core/` | 3.9 MB |
| `tesseract/lang/eng.traineddata.gz` | `@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` | 3.0 MB (LSTM int model) |

Only **one** core file is downloaded at runtime: with `corePath` pointing at the *directory*, the
worker picks `relaxedsimd` → `simd` → plain by feature detection (LSTM-only variants because we
use `OEM.LSTM_ONLY` and do not set `legacyCore`). Non-LSTM ("legacy") cores are not shipped – do
not use `OEM.TESSERACT_ONLY`/`TESSERACT_LSTM_COMBINED` or `worker.detect()`.

```ts
import { createScheduler, createWorker, OEM, PSM } from 'tesseract.js';

const base = import.meta.env.BASE_URL;
export const TESSERACT_WORKER_OPTIONS = {
  workerPath: `${base}tesseract/worker.min.js`,
  corePath: `${base}tesseract/core`,          // directory (no trailing slash needed)
  langPath: `${base}tesseract/lang`,          // worker fetches `${langPath}/eng.traineddata.gz`
  gzip: true,                                 // default; file is gzipped
  // cacheMethod: 'write' (default) caches eng.traineddata in IndexedDB → offline on later visits.
  // Use cacheMethod: 'none' while debugging asset problems.
  workerBlobURL: true,                        // default; paths are resolved to absolute URLs by tesseract.js
  logger: (m: { status: string; progress: number }) => { /* map to onProgress message */ },
  errorHandler: (err: unknown) => { /* surface via onError */ },
};

async function makeWorker() {
  const worker = await createWorker('eng', OEM.LSTM_ONLY, TESSERACT_WORKER_OPTIONS);
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,   // bands contain scattered bits of text; core rebuilds lines geometrically
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  return worker;
}

const scheduler = createScheduler();
const n = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1));
for (let i = 0; i < n; i += 1) scheduler.addWorker(await makeWorker());   // create lazily on first OCR need

// per band crop (Blob | File | HTMLCanvasElement | OffscreenCanvas are accepted; prefer a PNG Blob)
const { data } = await scheduler.addJob('recognize', cropBlob, {}, { text: false, blocks: true });
for (const block of data.blocks ?? [])
  for (const para of block.paragraphs)
    for (const line of para.lines)
      for (const word of line.words) {
        if (!word.text.trim()) continue;
        const { x0, y0, x1, y1 } = word.bbox;                     // crop pixels
        items.push({
          text: word.text,
          box: normalizeBandBox({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, bandRect, pageSize, cropSize),
          confidence: word.confidence / 100,
        });
      }
```
- v7 result shape: `data.blocks[].paragraphs[].lines[].words[]` with `bbox {x0,y0,x1,y1}` and
  `confidence` 0..100 (`data.words`/`data.lines` from v4 no longer exist). Request `blocks: true`.
- Crops (`pipeline/analyze.ts`): the top and bottom 15 % bands are rendered at ~300 dpi for PDF
  pages (width-capped at 3200 px) and at 1x for photos (downscaled above 2800 px wide, upscaled up
  to 2x below 1400 px), converted to greyscale with a 1st/99th-percentile contrast stretch
  (`helpers.ts` → `enhanceForOcr`) and encoded as PNG; each band is one job, `bands: ['top','bottom']`.
  If no candidate comes out of the bands and `fallbackFullPageOcr` is on (default), the whole page
  is OCR'd at ~150 dpi (≤ 6 MP) with `bands: ['full']`.
- Do not set `tessedit_char_whitelist` to digits – "Page", "of", roman numerals and the context
  words core relies on would be lost.
- `terminateScheduler()` on cancel/shutdown; the scheduler is recreated lazily afterwards. When
  the workers are still being created (first-time language download) the caller is not blocked:
  termination is chained onto the creation promise so cancelling stays prompt.
- The first OCR takes a few seconds (core + language load); tesseract's status is forwarded as
  `onProgress.message` ("OCR: loading language traineddata"). Measured in headless Edge (4 workers,
  cold cache): a 10-page image-only PDF is read in ~3.7-4.1 s end to end; a 50-page text-layer PDF
  in ~1.4 s.
- Offline: assets are plain static files (HTTP-cacheable) and the language data is cached in
  IndexedDB by tesseract.js after first use. A service worker is out of scope for v1.

---

## 6. Export contract (src/export/index.ts)

```ts
exportSortedPdf(request: ExportRequest): Promise<ExportResult>
downloadExport(result: ExportResult): void

interface ExportRequest { plan: ExportPlan; sources: ReadonlyMap<SourceFileId, Blob>; fileName?; onProgress?(done,total); signal?; addBookmarks? }
interface ExportResult  { blob: Blob; fileName: string; pageCount: number; durationMs: number }
```
Implementation notes (pdf-lib, `export/index.ts`):
- Each source PDF is loaded once (`PDFDocument.load`), then `out.copyPages(src, indices)` in plan
  order (lossless; preserves vector content; private page-dictionary keys survive, which the e2e
  suite uses to verify the order of image-only pages). Consecutive pages of the same source go
  through one `copyPages` call. Encrypted sources are rejected with a clear message.
- Images: JPEG bytes are embedded directly when their EXIF orientation is 1, PNG via `embedPng`;
  anything else (WebP, EXIF-rotated JPEG, PNGs pdf-lib cannot parse) is decoded with
  `createImageBitmap` (EXIF applied) and re-encoded through a canvas. **The page is the image
  fitted to an A4 sheet** in the image's own orientation (`helpers.ts` → `fitImageToPage`) rather
  than "1 px = 1 pt", so photos print at a sensible size. Verified in e2e: three photos become
  three 595×842 pt image pages.
- Rotation: `page.setRotation(degrees(combineRotation(page.getRotation().angle, rotation)))`.
- Progress per page; `signal` is checked between pages and a `DOMException('Cancelled','AbortError')` thrown.
- `downloadExport`: `<a download>` with an object URL, revoked 30 s later. File name:
  `<first file base name>-sorted.pdf` (verified through Playwright's download event).

---

## 7. UI guide

### 7.1 State (src/state)
```ts
interface AppState {
  sources: Record<SourceFileId, SourceFile>;
  files: Record<SourceFileId, File>;           // kept out of React rendering paths; needed for export
  pages: Record<PageId, PageRecord>;           // upsert from onPage
  overrides: UserOverrides;                    // start: EMPTY_OVERRIDES; every edit is undoable
  history: { past: UserOverrides[]; future: UserOverrides[] };   // 60 entries
  progress: PipelineProgress;  running: boolean;  errors: PipelineError[];  demo: boolean;
  ui: { editingPageId, lightboxPageId, highlight, exportStatus, notices, announcement, ... };
}
```
Actions (`reducer.ts`): `pipeline/started | batch | finished`, `edit {OverrideEdit}` (number/set,
number/clear, pages/remove, pages/restore, page/rotate, order/manual, order/auto – pure functions
in `overrides.ts`), `history/undo | redo`, `ui/*`, `export/status`, `notice/*`, `session/cleared`.
The theme lives outside the reducer (`theme.ts`, `localStorage`, applied as `data-theme` on `<html>`).

The result is derived with `useMemo`:
```ts
const pageList = useMemo(() => Object.values(state.pages), [state.pages]);
const result = useMemo(() => inferDocument(pageList, { overrides: state.overrides }), [pageList, state.overrides]);
```
It is cheap (≈10 ms / 300 pages). Pipeline callbacks are buffered and flushed as one
`pipeline/batch` every 120 ms (`store.tsx`) so a 240-page PDF does not re-render per page.
Note that inference is re-run on partial data while a shuffled document is still being read, so
early pages can briefly show as "No page number" until enough numbers are in to settle the range.

### 7.2 Calling the pipeline (`store.tsx`)
One batch runs at a time (`AbortController` per run, a `generation` counter guards stale
callbacks); files dropped during a run are queued and start automatically afterwards ("N files
will be read next"). Cancel aborts the controller; "Start over" aborts, releases thumbnails
(`releasePages` + `shutdownPipeline`) and resets the state. Adding real files to the `?demo`
session clears the demo first and removes `?demo` from the URL.

### 7.3 Rendering the grid
- Iterate `result.slots`. `kind:'page'` → thumbnail tile (apply `overrides.rotations[pageId]` with a
  CSS transform), badge = `formatPageNumber(assignment.number)` or "?" when `null`.
  Badge colour by `assignment.confidence`: ≥ 0.6 ok (green), < 0.6 warn (amber), unnumbered /
  `out-of-range` / `duplicate` conflict → danger. Tooltip = `assignment.reason`.
- `kind:'gap'` → placeholder tile "Page 17 missing" (or "Pages 20–35 missing" using `from/to/count`).
  Gap tiles are not draggable and are absent in manual-order mode.
- Click badge (or the pencil) → "Page number" dialog (`NumberEditor`); `parsePageNumberInput(text)` →
  `number/set` (null result = invalid, dialog stays open with an error); *This page has no number* →
  `number/set` with `null`; *Reset to automatic* → `number/clear`. `assignment.suggestions` are chips.
- Drag-to-reorder (dnd-kit sortable over `result.order`): on drop dispatch `order/manualSet` with
  the new id array; show a "Back to automatic order" button that dispatches `order/autoRestored`.
  Hint: when the user only wants to fix one number, editing the badge is better than dragging.
- Remove page → `overrides.removed`; rotate → `overrides.rotations`.

### 7.4 Warnings panel (from `result.report`)
- `missing`: one row per range ("Page 17 is missing", "Pages 20–35 are missing").
- `duplicates`: `'duplicate-scan'` → "Page 9 was scanned twice" + button *Remove extra*
  (removes `issue.safeToRemove`); `'conflict'` → "2 different pages all read as 9. Please check."
  (click scrolls to and flashes `pageIds`). The section header has one *Remove duplicate scans*
  button that removes the union of `safeToRemove` across issues (undoable, toast with Undo).
- `lowConfidence`: "Please confirm" list with confidence %, `reason` as tooltip, *Looks right* (sets the
  read number as a manual override) and *Change* (opens the number editor).
- `unnumbered`: "No page number" list with *Set number*; `assignment.source === 'manual'` means the user chose that.
- `notes`: info rows (`starts-above-one`, `total-detected`, `trailing-missing`, `manual-order`, `no-numbers-found`, `front-matter`).
- `summary` for the header: "All 16 pages in order" or "1 page missing · 1 duplicate · 2 unnumbered · 5 to confirm"
  (`derive.ts` → `headline()`; the clauses are `parts`, rendered so lines break only between clauses).

### 7.5 Export
```ts
const plan = buildExportPlan(pageList, result, state.overrides, Object.values(state.sources));
const out = await exportSortedPdf({ plan, sources: new Map(Object.entries(state.files)), onProgress, signal });
downloadExport(out);
```

### 7.6 Styling, theme, accessibility
- Use the tokens in `src/styles/tokens.css` (`--color-*`, `--space-*`, `--radius-*`, …). Add tokens
  rather than hard-coding colours. Dark theme: `prefers-color-scheme` + `data-theme` attribute on `<html>`.
- Responsive grid (`auto-fill, minmax(var(--thumb-width), 1fr)`); works at phone width (360 px).
  Below 900 px the summary panel sits above the grid and collapses behind its header, which is a
  real `<button aria-expanded>` only there (`useMediaQuery('(max-width: 899px)')`); on desktop the
  header is plain content and the panel is a sticky sidebar.
- Keyboard: every tile focusable; badge editor is a real `<input>`; dnd-kit `KeyboardSensor`
  with `sortableKeyboardCoordinates` (Space/Enter on the move handle, arrow keys, Space/Enter to
  drop, Esc to cancel); live region announcing re-sorts and edits.
- **Never let anything overflow the viewport horizontally**: dnd-kit's keyboard sensor turns an
  arrow key into a scroll attempt instead of a move when the document is wider than the window
  (the e2e suite asserts `scrollWidth <= clientWidth` on every screen).
- Native `<dialog>` modals (focus trap, Esc, inert background). Respect `prefers-reduced-motion`.

---

## 8. Conventions
- TypeScript strict, `verbatimModuleSyntax` (use `import type`), no `any`, no default exports except
  React components. Files: camelCase for modules, PascalCase for components. Named exports.
- Prettier-style formatting (2 spaces, single quotes, trailing commas, ~110 cols). `npm run lint` (oxlint) must pass.
- Tests: Vitest, colocated in `__tests__/` folders, `*.test.ts(x)`. Core tests run in Node (no DOM).
  `npm test` must stay green. UI/pipeline logic that can be pure should be pure and tested.
  Browser behaviour is covered by the Playwright suite (section 10): `npm run e2e` must stay green.
- No new runtime dependencies. No network calls at runtime. No telemetry.
- Do not mutate `PageRecord`s; produce new objects. State is plain data.
- Scripts: `npm run dev` (copies assets first), `npm run build` (tsc + vite), `npm run lint`,
  `npm test`, `npm run typecheck`, `npm run assets`, `npm run fixtures`, `npm run e2e`, `npm run e2e:ui`.

## 9. Known limitations / ideas for later
- Chapter-relative numbering ("3-12") and letter suffixes ("12a") are not recognised.
- Bare four-digit years (1900–2100) are always rejected; "Page 2019 of …" is still accepted.
- Roman numerals are capped at 100 (`MAX_ROMAN`).
- Alternation detection needs ≥ 2 pages on each side and ≥ 80 % parity agreement.
- When a second document prints its numbers somewhere else on the page (e.g. top centre after a
  book scan with bottom corners), its pages are numbered correctly but flagged "Please confirm"
  because the region factor lowers their confidence.
- No multi-select, no "re-read this page" button (`reanalyzePages` exists in the pipeline), no grid
  virtualisation (240 pages render fine; thousands would not).
- A service worker for true offline-first loading is not part of v1.

---

## 10. End-to-end suite (`e2e/`, Playwright)

`npm run e2e` builds the app, serves it with `vite preview` (port 4173) **and** starts the Vite dev
server (port 5173), then drives the locally installed Microsoft Edge (`channel: 'msedge'`, no
browser download). Two projects: `preview` runs every test against the production build;
`dev` runs the tests tagged `@dev` against the dev server (asset paths / workers differ). The
global setup runs `scripts/make-fixtures.mjs` when fixtures are missing.

Every test uses the `test` fixture from `e2e/support.ts`, which
- routes **every** request and aborts any whose origin is not the app's own, failing the test if
  one was attempted (this is the privacy promise, and it also covers the tesseract worker's
  fetches of the core and language data, which are asserted to be same-origin);
- fails on any uncaught page error, `console.error` or `console.warn` (React warnings included).

Specs: `demo.spec.ts` (every review interaction on `?demo`), `files.spec.ts` (each fixture PDF
against its ground truth, real OCR of an image-only PDF and PNG/EXIF-JPEG/WebP photos, mixed drops,
unsupported file, queued drops, cancel on a 240-page PDF, adding files after a run, timings),
`export.spec.ts` (download through Playwright's download event, verified in Node with pdf.js +
pdf-lib: order, rotation, image pages, file name), `screens.spec.ts` (screenshots at 1366×860 and
360×780, light and dark, into `e2e/screenshots/` or `$SCREENS_DIR`, plus horizontal-overflow checks).
