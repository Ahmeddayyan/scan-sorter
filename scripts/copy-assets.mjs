#!/usr/bin/env node
/**
 * Copies the runtime assets that must be served from the app's own origin
 * (no CDN, no third-party requests at runtime) from node_modules into public/.
 *
 * Output (all gitignored):
 *   public/tesseract/worker.min.js                       tesseract.js web worker
 *   public/tesseract/core/tesseract-core-lstm.wasm.js             \
 *   public/tesseract/core/tesseract-core-simd-lstm.wasm.js         > one is picked at runtime by SIMD support
 *   public/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js /   (wasm is embedded inside each .wasm.js)
 *   public/tesseract/lang/eng.traineddata.gz             English LSTM "best_int" model (~3 MB)
 *   public/pdfjs/wasm/*                                  pdf.js image decoders (JBIG2 / JPX / qcms) - needed for scanned PDFs
 *   public/pdfjs/standard_fonts/*                        pdf.js standard 14 font fallbacks
 *   public/pdfjs/cmaps/*                                 pdf.js CMaps (text extraction for CJK / composite fonts)
 *   public/pdfjs/iccs/*                                  pdf.js ICC profiles
 *
 * The pdf.js worker itself is NOT copied here: import it through Vite with
 *   import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
 * so it is fingerprinted and served from the same origin by the bundler.
 *
 * Runs on postinstall, predev and prebuild; it is idempotent and skips files
 * whose size already matches (fast no-op on repeated runs).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

function packageDir(name) {
  // None of these packages restrict `package.json` via an "exports" map, so this is safe.
  return path.dirname(require.resolve(`${name}/package.json`, { paths: [ROOT] }));
}

const tesseractDir = packageDir('tesseract.js');
const coreDir = packageDir('tesseract.js-core');
const engDir = packageDir('@tesseract.js-data/eng');
const pdfjsDir = packageDir('pdfjs-dist');

/** @type {Array<{ from: string, to: string }>} */
const files = [
  { from: path.join(tesseractDir, 'dist', 'worker.min.js'), to: path.join(PUBLIC, 'tesseract', 'worker.min.js') },
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map(
    (name) => ({ from: path.join(coreDir, name), to: path.join(PUBLIC, 'tesseract', 'core', name) }),
  ),
  {
    from: path.join(engDir, '4.0.0_best_int', 'eng.traineddata.gz'),
    to: path.join(PUBLIC, 'tesseract', 'lang', 'eng.traineddata.gz'),
  },
];

/** @type {Array<{ from: string, to: string }>} */
const dirs = ['wasm', 'standard_fonts', 'cmaps', 'iccs'].map((d) => ({
  from: path.join(pdfjsDir, d),
  to: path.join(PUBLIC, 'pdfjs', d),
}));

let copied = 0;
let skipped = 0;

function copyFile(from, to) {
  if (!existsSync(from)) {
    throw new Error(`copy-assets: missing source file ${from} (did npm install finish?)`);
  }
  const srcStat = statSync(from);
  if (existsSync(to) && statSync(to).size === srcStat.size) {
    skipped += 1;
    return;
  }
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
}

function copyDir(from, to) {
  if (!existsSync(from)) {
    throw new Error(`copy-assets: missing source directory ${from}`);
  }
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) copyFile(src, dst);
  }
}

for (const f of files) copyFile(f.from, f.to);
for (const d of dirs) copyDir(d.from, d.to);

console.log(`copy-assets: ${copied} file(s) copied, ${skipped} up to date -> ${path.relative(ROOT, PUBLIC)}/`);
