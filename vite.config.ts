import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
