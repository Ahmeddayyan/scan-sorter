# Test fixtures

`generated/` (gitignored) is produced by `npm run fixtures` (`scripts/make-fixtures.mjs`); the
Playwright global setup runs it automatically when files are missing. Ground truth is in the
script and asserted by `src/pipeline/__tests__/fixtures.test.ts` (Node, text layer) and
`e2e/files.spec.ts` / `e2e/export.spec.ts` (Edge, the real pipeline).

| File | What it exercises |
|---|---|
| `shuffled-missing7-dup4.pdf` | 12 pages shuffled, page 7 missing, page 4 twice, decoy header / copyright line |
| `page-of-10-trailing-missing.pdf` | "Page N of 10" footers, pages 9-10 missing (trailing gap from the total) |
| `front-matter-roman.pdf` | roman i-iv then arabic 1-6, one unnumbered insert |
| `book-alternating-21-36.pdf` | odd pages bottom-right / even pages bottom-left, running heads |
| `excerpt-dashed-37-45.pdf` | "- 37 -" style header numbers, starts above 1 (no leading gap reported) |
| `unnumbered.pdf` | text layer without any number (goes through OCR, stays unnumbered) |
| `long-1-50.pdf` | 50 shuffled pages, text-layer timing |
| `appendix-51-60.pdf` | 51-60, dropped while `long-1-50.pdf` is being read (queued files) |
| `big-shuffled-240.pdf` | 240 shuffled pages, every third one without a number (OCR) - cancel mid-run |
| `scan-only-1-10.pdf` | 10 JPEG page images, no text layer: real OCR; each page carries a private `/ScanSorterTestPage` key so the exported order can be verified without OCR |
| `photo-p1.png`, `photo-p2-exif6.jpg`, `photo-p3.webp` | "photos" of pages 1-3; the JPEG is stored sideways with EXIF orientation 6 |
| `notes.txt` | unsupported input |

The scan-like files need `@napi-rs/canvas` (an optional dependency of pdfjs-dist that npm installs
on supported platforms); without it the script skips them and the OCR e2e tests are skipped.

Put small real-world samples (scans, photos) here if you want them in the repo; keep them under
~1 MB each. Do not commit anything private.

Core-engine unit tests do not use this folder: they build synthetic `PageRecord`s in
`src/core/__tests__/helpers.ts`.
