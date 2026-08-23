import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import { sameOriginSuperdoughWorklet } from '../../vite/superdough-worklet'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [viteReact(), sameOriginSuperdoughWorklet()],
})
