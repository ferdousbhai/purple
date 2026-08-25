import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import { sameOriginSuperdoughWorklet } from './vite/superdough-worklet'
import { initialBundleBudget } from './vite/initial-bundle-budget'
import { hostedPageHints } from './vite/hosted-page-hints'

// The hosted CI build enforces the synchronous startup graph, excluding lazy
// editor and audio-engine chunks. Keep headroom for small product changes.
const INITIAL_JAVASCRIPT_GZIP_BUDGET = 75 * 1024

export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    // The hosted document embeds the one application stylesheet. Keeping CSS
    // out of lazy-chunk metadata prevents Vite from requesting that deleted
    // asset again when a route or editor chunk is evaluated.
    cssCodeSplit: false,
    // CodeMirror is deliberately deferred. Initial JavaScript has the stricter
    // gzip gate above; retain a warning for other chunks.
    chunkSizeWarningLimit: 525,
  },
  plugins: [
    viteReact(),
    sameOriginSuperdoughWorklet(),
    initialBundleBudget(INITIAL_JAVASCRIPT_GZIP_BUDGET),
    hostedPageHints(),
  ],
})
