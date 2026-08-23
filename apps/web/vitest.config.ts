import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  logLevel: 'error',
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '**/*.browser.test.tsx'],
  },
})
