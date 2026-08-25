import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const chromiumArgs = [
  '--headless',
  '--no-sandbox',
  '--remote-debugging-pipe',
  '--no-startup-window',
  '--disable-background-networking',
  '--disable-gpu',
  // GitHub's job container has a 64 MiB /dev/shm. Playwright normally adds
  // this safeguard, but ignoreDefaultArgs removes it with the incompatible
  // revision-specific flags we deliberately replace below.
  ...(process.env.CI ? ['--disable-dev-shm-usage'] : []),
]

const chromiumEnvironment = process.platform === 'linux'
  ? {
      ...definedEnvironment(),
      // Headless Chromium does not need desktop power/session services. Some
      // Linux buses abort the process instead of timing out cleanly here.
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null',
      DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/dev/null',
    }
  : undefined

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
          env: chromiumEnvironment,
          // Arch Chromium can reject Playwright's revision-specific defaults.
          // These are the minimum flags needed to control the installed browser.
          ignoreDefaultArgs: true,
          args: chromiumArgs,
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
})

function definedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value]]),
  )
}
