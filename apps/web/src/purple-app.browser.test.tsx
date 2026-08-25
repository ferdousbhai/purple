/* oxlint-disable anti-slop/no-module-mocking -- The app-shell flow keeps lazy routes and audio ownership deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted mutable fixture needs an explicit collection type. */
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import './styles.css'
import { PurpleApp } from './purple-app'

const shell = vi.hoisted(() => ({
  created: 0,
  instances: [] as Array<{
    activeCode: string
    id: number
    play(code: string): Promise<{ ok: true }>
    stop(): void
    stopCalls: number
  }>,
}))

vi.mock('@purple/ui/use-playback', async () => {
  const React = await import('react')
  return {
    usePlayback() {
      const [playback] = React.useState(() => {
        const instance = {
          activeCode: '',
          id: ++shell.created,
          async play(code: string) {
            instance.activeCode = code
            return { ok: true as const }
          },
          stop() {
            instance.activeCode = ''
            instance.stopCalls++
          },
          stopCalls: 0,
        }
        shell.instances.push(instance)
        return instance
      })
      return playback
    },
  }
})

interface RoutePlayback {
  activeCode: string
  id: number
  play(code: string): Promise<{ ok: true }>
}

vi.mock('#/components/purple-studio', async () => {
  const React = await import('react')
  return {
    PersistentPurpleStudio(props: {
      navigate(href: string): void
      playback: RoutePlayback
      sharedPattern?: { title: string }
    }) {
      return React.createElement(
        'main',
        { 'data-testid': 'studio-route' },
        React.createElement('span', null, `PLAYBACK ${props.playback.id}`),
        React.createElement('span', null, props.sharedPattern?.title ?? 'Local studio'),
        React.createElement('button', {
          onClick: () => void props.playback.play('persistent-pattern'),
        }, 'START AUDIO'),
        React.createElement('button', {
          onClick: () => props.navigate('/patterns'),
        }, 'BROWSE PATTERNS'),
      )
    },
  }
})

vi.mock('#/components/patterns-page', async () => {
  const React = await import('react')
  return {
    PersistentPatternsPage(props: {
      navigate(href: string): void
      playback: RoutePlayback
    }) {
      return React.createElement(
        'main',
        { 'data-testid': 'patterns-route' },
        React.createElement('span', null, `PLAYBACK ${props.playback.id}`),
        React.createElement('span', null, `ACTIVE ${props.playback.activeCode}`),
        React.createElement('button', {
          onClick: () => props.navigate('/?s=Abc_123-xYz9'),
        }, 'OPEN SHARED'),
      )
    },
  }
})

vi.mock('#/lib/public-patterns', () => ({
  fetchSharedPattern: async () => ({
    id: 'Abc_123-xYz9',
    title: 'Shared route pattern',
    code: 's("hh*8")',
    createdAt: 1,
    likes: 0,
    dislikes: 0,
    score: 0,
    viewerVote: 0,
  }),
}))

beforeEach(() => {
  shell.created = 0
  shell.instances.length = 0
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

it('keeps one playback owner through links, shared patterns, and popstate', async () => {
  render(<PurpleApp />)
  await screen.findByTestId('studio-route')

  await userEvent.click(screen.getByRole('button', { name: 'START AUDIO' }))
  await userEvent.click(screen.getByRole('button', { name: 'BROWSE PATTERNS' }))

  await screen.findByTestId('patterns-route')
  expect(screen.getByText('ACTIVE persistent-pattern')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'OPEN SHARED' }))

  await screen.findByText('Shared route pattern')
  act(() => {
    window.history.pushState(null, '', '/patterns')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  await screen.findByTestId('patterns-route')
  await waitFor(() => expect(screen.getByText('ACTIVE persistent-pattern')).toBeVisible())
  expect(shell.created).toBe(1)
  expect(shell.instances[0]?.stopCalls).toBe(0)
})
