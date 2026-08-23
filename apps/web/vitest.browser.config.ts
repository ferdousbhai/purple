import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { host: '127.0.0.1' },
  resolve: { tsconfigPaths: true },
  plugins: [viteReact()],
  test: {
    fileParallelism: false,
    include: ['src/**/*.browser.test.tsx'],
    setupFiles: ['./src/browser-test-setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      api: { host: '127.0.0.1' },
      provider: playwright({
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
          // Arch Chromium can reject Playwright's revision-specific defaults.
          // These are the minimum flags needed to control the installed browser.
          ignoreDefaultArgs: true,
          args: [
            '--headless',
            '--no-sandbox',
            '--remote-debugging-pipe',
            '--no-startup-window',
          ],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
