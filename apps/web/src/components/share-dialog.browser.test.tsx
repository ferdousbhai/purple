/* oxlint-disable anti-slop/no-module-mocking -- The dialog flow keeps Turnstile and the public API deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted deferred fixture needs an explicit nullable type. */
import { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareDialog } from './share-dialog'

const sharing = vi.hoisted(() => ({
  gate: null as { promise: Promise<void>; resolve(): void } | null,
}))

vi.mock('#/lib/public-patterns', () => ({
  async createSharedPattern() {
    await sharing.gate?.promise
    return 'New_123-xYz9'
  },
  sharedPatternUrl: (id: string) => `https://soundspurple.com/?s=${id}`,
}))

vi.mock('./turnstile-widget', async () => {
  const React = await import('react')
  return {
    TurnstileFormEnd(props: {
      children: React.ReactNode
      onToken(token: string): void
    }) {
      React.useEffect(() => props.onToken('test-token'), [props.onToken])
      return React.createElement(React.Fragment, null, props.children)
    },
  }
})

beforeEach(() => {
  sharing.gate = deferred()
})

afterEach(() => cleanup())

describe('share dialog', () => {
  it('cannot be dismissed while public publication is in flight', async () => {
    const onClose = vi.fn()
    const onShared = vi.fn()
    const user = userEvent.setup()
    render(
      <ShareDialog
        code={'s("bd*4")'}
        existingId={null}
        onClose={onClose}
        onShared={onShared}
        title="Acid rain"
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'PUBLISH PATTERN' }))
    expect(screen.getByRole('button', { name: 'PUBLISHING…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close sharing' })).toBeDisabled()

    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => sharing.gate?.resolve())
    expect(await screen.findByText('PATTERN PUBLISHED')).toBeVisible()
    expect(onShared).toHaveBeenCalledWith('New_123-xYz9', 'Acid rain')
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
