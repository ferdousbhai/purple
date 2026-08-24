import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import { sameOriginSuperdoughWorklet } from './vite/superdough-worklet'
import { initialBundleBudget } from './vite/initial-bundle-budget'

// The hosted CI build enforces the synchronous startup graph, excluding lazy
// editor and audio-engine chunks. Keep headroom for small product changes.
const INITIAL_JAVASCRIPT_GZIP_BUDGET = 110 * 1024

export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    // CodeMirror is a deliberately deferred 507 kB chunk. Initial JavaScript
    // has the stricter gzip gate above; retain a warning for other chunks.
    chunkSizeWarningLimit: 525,
  },
  plugins: [
    viteReact(),
    sameOriginSuperdoughWorklet(),
    initialBundleBudget(INITIAL_JAVASCRIPT_GZIP_BUDGET),
  ],
})
