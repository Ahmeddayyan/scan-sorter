# Scan Sorter

Put shuffled scans back in order. Find missing pages. Nothing leaves your device.

Scan Sorter is a browser app for putting a stack of scanned pages back in order. Drop in
shuffled PDFs or phone photos of pages, let the app read the printed page numbers, check the
result for gaps and duplicates, fix what it could not read, and download a sorted PDF. Everything
runs in the browser tab. No server, no uploads, no accounts.

## The problem

A scanner feeder jams, a stack gets dropped, or someone photographs a chapter page by page.
The result is dozens of files in the wrong order, with no obvious way to tell whether page 17
was skipped or scanned twice. Sorting by file name does not help, and reading every page by
hand is slow. Scan Sorter reads the page numbers printed on each page and tells you exactly
which ones are missing, duplicated, or unclear.

## Features

- **Reads printed page numbers** from the PDF text layer when one exists, and from the page's
  header and footer with OCR (tesseract.js, running in the browser) when it does not.
- **Sorts the pages** into document order, including roman front matter before arabic body pages.
- **Flags problems** in a warnings panel:
  - missing pages ("Page 17 missing", "Pages 20-35 missing");
  - duplicate scans (the same page scanned twice);
  - two different pages that read as the same number;
  - unnumbered pages and low-confidence readings.
- **Lets you fix things:** edit a page's number, drag pages to reorder (mouse, touch or
  keyboard), rotate, or remove a page. Every change can be undone.
- **Downloads a sorted PDF.** Pages from PDF inputs are copied as-is, so text and vector
  content are preserved. Phone photos become A4 pages in the output, upright.
- **Try it without files:** the "Try it with sample pages" link (`?demo`) loads a synthetic
  32-page session with a missing page, a duplicate scan, a conflict and unclear reads.

## Privacy model

Scan Sorter is designed so that your documents never leave the browser tab.

| Step | Where it runs |
|---|---|
| Opening files, rendering pages (pdf.js) | Your browser |
| Reading the text layer | Your browser |
| OCR of header and footer (tesseract.js) | Your browser, in a web worker |
| Duplicate detection (perceptual hash) | Your browser |
| Sorting, warnings, and editing | Your browser |
| Building the sorted PDF (pdf-lib) | Your browser |

What is and is not network traffic:

- **At runtime there are no third-party requests.** The pdf.js decoders, the tesseract.js worker
  and WebAssembly core, and the English OCR language model are all served from the app's own
  origin. No CDN is used.
- **The OCR language data is cached in IndexedDB** by tesseract.js after its first download, so
  later visits do not fetch it again. Clearing site data in your browser removes it.
- **No telemetry and no analytics.**
- **The browser enforces it.** The deployed site sends a Content-Security-Policy (see
  `vercel.json`) whose `connect-src`, `script-src` and `img-src` allow only the app's own origin
  (plus local `blob:`/`data:` URLs), so even a bug could not send a request elsewhere.
  `vite preview` serves the same headers, so the e2e suite runs under the production policy.

### How to verify it yourself

1. Open the app and press F12 (or Ctrl+Shift+I) to open DevTools.
2. Go to the **Network** tab and tick **Preserve log**.
3. Drop a PDF or a set of photos into the app and let the analysis finish.
4. Every request should point to the same host the app was loaded from. Filter by domain or
   sort by "Domain" to confirm. Nothing should be sent to another host, and no request should
   carry your file contents.

The end-to-end suite enforces this automatically: every test blocks any request to a foreign
origin and fails if one was attempted, including the OCR worker's own downloads.

## Quick start

Requirements: **Node.js 22.12 or newer** (developed on 24) and npm. The end-to-end tests additionally need
**Microsoft Edge** installed (Playwright drives it; no browser download).

```bash
npm install       # also runs the postinstall step that copies OCR and pdf.js assets into public/
npm run dev       # start the dev server (copies assets first)
```

Then open the URL that Vite prints.

### Scripts

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies. The postinstall step copies assets from `node_modules` into `public/` (`scripts/copy-assets.mjs`). |
| `npm run dev` | Starts the Vite dev server. Copies assets first (`predev`). |
| `npm run build` | Type-checks (`tsc -b`) and builds the production bundle with Vite into `dist/`. Copies assets first (`prebuild`). |
| `npm run preview` | Serves the production build locally for a final check. |
| `npm test` | Runs the Vitest suite once. Core tests run in Node with no DOM. |
| `npm run test:watch` | Runs Vitest in watch mode. |
| `npm run typecheck` | Type-checks the project without building. |
| `npm run lint` | Runs oxlint. |
| `npm run fixtures` | Generates synthetic test inputs into `test-fixtures/generated/` (gitignored): text-layer PDFs, an image-only PDF, PNG/JPEG/WebP photos. |
| `npm run e2e` | Runs the Playwright end-to-end suite in Microsoft Edge: builds the app, serves it with `vite preview` and the dev server, drives real files through pdf.js and tesseract.js, verifies the downloaded PDF, takes screenshots into `e2e/screenshots/`. |
| `npm run e2e:ui` | The same suite in Playwright's UI mode. |
| `npm run assets` | Re-copies the OCR and pdf.js assets into `public/`. Useful after changing `node_modules`. |

Generated folders (`public/tesseract/`, `public/pdfjs/`, `test-fixtures/generated/`,
`e2e/screenshots/`, `test-results/`) are not committed. They are recreated by the scripts above.

### Deployment

The app is a static site deployed on Vercel. `vercel.json` sets the build (`npm ci`,
`npm run build`, output `dist/`), the security headers, and caching: hashed files in
`/assets/` are cached for a year, while the OCR and pdf.js files are cached for a week. Every
push to `main` redeploys. Any static host works if it serves `dist/` with the same headers. If
you change the inline theme script in `index.html`, update its `sha256-…` hash in the CSP.

## How it works

1. **Read each file.** PDFs are opened with pdf.js and each page is rendered to a small
   thumbnail. Photos are decoded with their EXIF orientation applied.
2. **Find the numbers.** If a page has a text layer with a number in its header or footer, its
   words are used directly. Otherwise the top and bottom 15 % of the page are rendered at about
   300 DPI, cleaned up (greyscale, contrast stretch) and OCR'd with tesseract.js; if that finds
   nothing, the whole page is OCR'd once at a lower resolution.
3. **Pick a candidate per page.** Every number-like token is scored by where it sits (header,
   footer, or body), its pattern ("Page 12", "12 of 40", "- 12 -"), how isolated it is, its font
   size, and OCR confidence. Years, dates, phone numbers, labelled numbers such as "Chapter 3",
   and footnote markers are rejected.
4. **Infer the document.** Across all pages, the app works out the dominant numbering range and
   style, whether the layout alternates between odd and even pages (book scans), and the "of M"
   total when there is one. Each page's candidates are re-scored against that picture. A
   single-character OCR misread such as "1" vs "7" is corrected only when exactly one value fits
   the gap; ambiguous cases are offered as suggestions instead.
5. **Detect duplicates.** Each page gets a 64-bit difference hash (dHash) of its thumbnail.
   Pages with the same number and a near-identical hash are reported as duplicate scans; pages
   with the same number and different hashes are reported as conflicts to check.
6. **Review and export.** You see the sorted grid with "Page 17 missing" tiles where pages are
   missing, plus the summary panel. Your edits are stored as overrides on top of the automatic
   result, and the result is recalculated on every change. "Download sorted PDF" copies the pages
   in the final order into a new PDF named `<first file>-sorted.pdf`; if pages are missing or
   two pages claim the same number it asks "Download anyway?" first.

The core logic (candidate extraction, inference, reporting, and export planning) is pure
TypeScript with no DOM access, so it is covered by unit tests that run in Node. The browser
parts (pdf.js rendering, OCR workers, drag and drop, download) are covered by the Playwright
suite running in Microsoft Edge.

Rough timings measured in headless Edge on a laptop: a 50-page text-layer PDF is read in about
1.5 s; a 10-page image-only PDF through OCR in about 4 s including loading the OCR engine;
cancelling a run takes well under a second.

## Supported inputs and page-number formats

**Inputs**

- PDF files (text-layer or scanned), including multi-page PDFs.
- Image files such as JPEG and PNG photos, one page per image.

**Recognised number patterns**

| Pattern | Examples |
|---|---|
| Bare number in a header or footer | `12` |
| Page word before the number | `Page 12`, `p. 12`, `pg 12`, `Seite 12`, `pagina 12`, `folio 12` |
| Total after the number | `12 of 40`, `12 / 40`, `12/40`, `12 out of 40` |
| Page word with total | `Page 12 of 40` |
| Dashed | `- 12 -` |
| Bracketed | `[12]`, `(12)` |
| Roman numerals (front matter) | `iv`, `XII` (up to 100, see limitations) |

Numbers in the body of a page are only accepted when they are alone on their line, so a number
inside a sentence is ignored.

## Known limitations

- Chapter-relative numbering such as `3-12` is not recognised.
- Letter suffixes such as `12a` are not recognised.
- Bare four-digit numbers from 1900 to 2100 are rejected as probable years. A page number that
  is labelled ("Page 2019") or part of "N of M" is still accepted.
- Roman numerals are only recognised up to 100.
- Arabic page numbers up to 9999 are accepted.
- Page-number detection needs the number to be in the top or bottom 15 % of the page, or
  alone on its line in the body.
- Book-style odd/even alternation is detected only with at least two pages on each side and
  at least 80 % agreement.
- Mixing documents whose numbers sit in different places (bottom corners in one, top centre in
  another) sorts correctly but marks the minority pages "Please confirm".
- HEIC/HEIF photos are not supported; save them as JPG first.
- English is the only OCR language in v1.
- There is no service worker in v1. Offline use depends on the browser keeping the app files
  and the cached OCR data; full offline installation is on the roadmap.

## Project structure

```
scan-sorter/
├─ docs/
│  ├─ ARCHITECTURE.md        Architecture, module contracts and data flow
│  └─ USER_GUIDE.md          Plain-language guide for people using the app
├─ e2e/                      Playwright end-to-end suite (npm run e2e) + playwright.config.ts
├─ LICENSE                   MIT
├─ scripts/
│  ├─ copy-assets.mjs        Copies OCR and pdf.js assets from node_modules into public/
│  └─ make-fixtures.mjs      Generates synthetic test inputs (npm run fixtures)
├─ public/                   Static files served as-is; generated subfolders are gitignored
├─ test-fixtures/
│  ├─ README.md              What the fixtures are for
│  └─ generated/             Synthetic inputs created by npm run fixtures (gitignored)
└─ src/
   ├─ core/                  Pure TypeScript, no DOM: number extraction, inference,
   │                         report, export plan, hashing, and their unit tests (__tests__/)
   ├─ pipeline/              Browser I/O: pdf.js, image decoding, OCR, thumbnails, hashing
   ├─ export/                Builds the sorted PDF with pdf-lib and triggers the download
   ├─ state/                 Application state (reducer and context)
   ├─ components/            React UI components (page grid, warnings panel, editors)
   ├─ styles/                Design tokens and plain CSS
   ├─ App.tsx, main.tsx      Application entry point
   └─ ...
```

## Tech stack

- Vite 8, React 19, TypeScript 6 (strict mode)
- pdf.js (`pdfjs-dist`) for reading and rendering PDFs
- tesseract.js 7 for OCR, self-hosted with the English LSTM model
- pdf-lib for building the output PDF
- dnd-kit for drag-and-drop reordering
- Vitest for unit tests, Playwright (Microsoft Edge) for end-to-end tests, oxlint for linting
- Plain CSS with design tokens. State is handled with `useReducer` and context.

No backend, database, or third-party runtime service.

## Roadmap ideas

These are ideas, not commitments:

- Installable as a PWA, with a service worker for reliable offline use.
- OCR language packs beyond English.
- Automatic rotation detection for sideways scans.
- Batch splitting, for example splitting one sorted PDF into chapters.

## Contributing

Read `docs/ARCHITECTURE.md` first. It describes the modules, the shared types in
`src/core/types.ts`, and the rules (no new runtime dependencies, no runtime network calls;
`npm test`, `npm run lint`, `npm run build` and `npm run e2e` must pass).

## License

MIT, see [`LICENSE`](LICENSE).

Copyright (c) 2026 Ahmed Ayyan

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
