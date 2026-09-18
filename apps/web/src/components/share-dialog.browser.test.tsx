/* oxlint-disable anti-slop/no-module-mocking -- The dialog flow keeps Turnstile and the public API deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted deferred fixture needs an explicit nullable type. */
import { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareDialog } from './share-dialog'

const sharing = vi.hoisted(() => ({
  gate: null as { promise: Promise<void>; resolve(): void } | null,
  issueToken: true,
  publishError: null as Error | null,
}))

vi.mock('#/lib/public-patterns', () => ({
  async createSharedPattern() {
    await sharing.gate?.promise
    if (sharing.publishError) throw sharing.publishError
    return 'New_123-xYz9'
  },
  sharedPatternUrl: (id: string) => `https://soundspurple.com/?s=${id}`,
}))

vi.mock('./turnstile-widget', async () => {
  const React = await import('react')
  const actual = await vi.importActual<typeof import('./turnstile-widget')>('./turnstile-widget')
  return {
    useTurnstile: actual.useTurnstile,
    TurnstileFormEnd(props: {
      children: React.ReactNode
      turnstile: { accept(token: string): void; error: string | null }
    }) {
      React.useEffect(() => {
        if (sharing.issueToken) props.turnstile.accept('test-token')
      }, [props.turnstile.accept])
      return React.createElement(
        React.Fragment,
        null,
        props.turnstile.error
          ? React.createElement('p', { className: 'error', role: 'alert' }, props.turnstile.error)
          : null,
        props.children,
      )
    },
  }
})

beforeEach(() => {
  sharing.gate = deferred()
  sharing.issueToken = true
  sharing.publishError = null
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('share dialog', () => {
  it('cannot be dismissed while public publication is in flight', async () => {
    const onClose = vi.fn()
    const onShared = vi.fn()
    const user = userEvent.setup()
    render(dialog({ onClose, onShared }))

    await user.click(await screen.findByRole('button', { name: 'PUBLISH PATTERN' }))
    expect(screen.getByRole('button', { name: 'PUBLISHING…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close sharing' })).toBeDisabled()

    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => sharing.gate?.resolve())
    expect(await screen.findByText(
      'This pattern is published, and anyone with the link can play it.',
    )).toBeVisible()
    expect(onShared).toHaveBeenCalledWith('New_123-xYz9', 'Acid rain')
  })

  it('keeps publish disabled with a checking label until Turnstile returns a token', async () => {
    sharing.issueToken = false
    sharing.gate = null
    render(dialog())

    expect(await screen.findByRole('button', { name: 'CHECKING…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'PUBLISH PATTERN' })).toBeNull()
  })

  it('says a later publish is a new public pattern', async () => {
    sharing.gate = null
    render(dialog({ republish: true }))

    expect(await screen.findByText(
      /This publishes a new public pattern. The previous share link stays as it was./,
    )).toBeVisible()
  })

  it('shows the service error instead of a generic retry', async () => {
    sharing.publishError = new Error('Too many shares from this network. Wait a minute.')
    const user = userEvent.setup()
    render(dialog())

    await user.click(await screen.findByRole('button', { name: 'PUBLISH PATTERN' }))
    await act(async () => sharing.gate?.resolve())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many shares from this network. Wait a minute.',
    )
  })

  it('offers a native share action when the browser can share', async () => {
    const share = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true,
    })
    const user = userEvent.setup()
    render(dialog({ existingId: 'New_123-xYz9' }))

    await user.click(await screen.findByRole('button', { name: 'SHARE' }))
    expect(share).toHaveBeenCalledWith({
      title: 'Acid rain',
      url: 'https://soundspurple.com/?s=New_123-xYz9',
    })
  })
})

function dialog(overrides: {
  existingId?: string | null
  onClose?: () => void
  onShared?: (id: string, title: string) => void
  republish?: boolean
} = {}) {
  return (
    <ShareDialog
      code={'s("bd*4")'}
      existingId={overrides.existingId ?? null}
      onClose={overrides.onClose ?? (() => undefined)}
      onShared={overrides.onShared ?? (() => undefined)}
      republish={overrides.republish ?? false}
      title="Acid rain"
    />
  )
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
