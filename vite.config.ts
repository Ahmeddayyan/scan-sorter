import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Serve the production site-wide headers (CSP etc.) from vercel.json in `vite preview`, so the
// e2e suite runs under the same policy as the deployed app. Not applied to the dev server,
// whose HMR preamble is an inline script the CSP would block.
interface VercelHeaderRule {
  source: string
  headers: { key: string; value: string }[]
}
const vercelConfig = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: VercelHeaderRule[]
}
const siteHeaders = Object.fromEntries(
  vercelConfig.headers
    .filter((rule) => rule.source === '/(.*)')
    .flatMap((rule) => rule.headers.map((h) => [h.key, h.value])),
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    headers: siteHeaders,
  },
  build: {
    // tesseract.js / pdfjs are large; raise the warning threshold so builds stay quiet.
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    // The heavy libraries are only reached through dynamic import(); pre-bundle them at dev
    // server start so their discovery does not trigger a full page reload mid-session.
    include: ['tesseract.js', 'pdfjs-dist', 'pdf-lib', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
  },
  // Vitest: core engine tests run in plain Node (no DOM). UI tests (phase 2+) may opt
  // into jsdom per-file with `// @vitest-environment jsdom` if that dep is added later.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
