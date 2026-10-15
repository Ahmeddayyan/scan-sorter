import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = path.join(ROOT, 'test-fixtures', 'generated');

/** Make sure the synthetic fixtures exist (text-layer PDFs, scan-like images, the big PDF). */
export default function globalSetup(): void {
  const required = ['shuffled-missing7-dup4.pdf', 'big-shuffled-240.pdf', 'appendix-51-60.pdf', 'scan-only-1-10.pdf', 'photo-p3.webp', 'notes.txt'];
  if (required.every((name) => existsSync(path.join(GENERATED, name)))) return;
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-fixtures.mjs')], { stdio: 'inherit' });
}
