import { describe, expect, it, vi } from 'vitest'
import { recoverFromPreloadError } from './chunk-reload'

describe('lazy chunk reload recovery', () => {
  it('reloads once and suppresses the stale import error', () => {
    const values = new Map<string, string>()
    const storage = mapStorage(values)
    const reload = vi.fn()
    const event = new Event('vite:preloadError', { cancelable: true })

    expect(recoverFromPreloadError(event, () => storage, reload, 10_000)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
    expect(values.get('purple:chunk-reload')).toBe('10000')
  })

  it('lets a repeated error surface instead of entering a reload loop', () => {
    const storage = mapStorage(new Map([['purple:chunk-reload', '10000']]))
    const reload = vi.fn()
    const event = new Event('vite:preloadError', { cancelable: true })

    expect(recoverFromPreloadError(event, () => storage, reload, 20_000)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload when session storage is unavailable', () => {
    const reload = vi.fn()
    const event = new Event('vite:preloadError', { cancelable: true })
    const storage = {
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: vi.fn(),
    }

    expect(recoverFromPreloadError(event, () => storage, reload)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not throw when reading session storage is blocked', () => {
    const reload = vi.fn()
    const event = new Event('vite:preloadError', { cancelable: true })

    expect(recoverFromPreloadError(event, () => {
      throw new DOMException('storage blocked', 'SecurityError')
    }, reload)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})

function mapStorage(values: Map<string, string>): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}
