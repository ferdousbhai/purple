import '../styles.css'
import { cleanup, render, waitFor } from '@testing-library/react'
import { AudioVisualizer } from '@purple/ui/audio-visualizer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const contexts: AudioContext[] = []
afterEach(async () => {
  cleanup()
  await Promise.all(contexts.splice(0).map((context) => context.close()))
  vi.restoreAllMocks()
})

function outputTap() {
  const context = new AudioContext()
  contexts.push(context)
  const analyser = context.createAnalyser()
  const spectrum = vi.spyOn(analyser, 'getByteFrequencyData').mockImplementation((bins) => {
    bins.fill(160)
  })
  vi.spyOn(analyser, 'getByteTimeDomainData').mockImplementation((samples) => {
    samples.forEach((_, index) => { samples[index] = 128 + Math.round(Math.sin(index / 12) * 50) })
  })
  return { analyser, spectrum }
}

function fixture(active: boolean, getAnalyser: () => AnalyserNode | null) {
  return <div style={{ width: 600, height: 280, display: 'flex', flexDirection: 'column' }}>
    <AudioVisualizer active={active} getAnalyser={getAnalyser} />
  </div>
}

describe('live audio visualization', () => {
  it('finds late audio taps, follows context replacement, and stops polling on stop', async () => {
    const first = outputTap()
    const second = outputTap()
    let tap: AnalyserNode | null = null
    const getAnalyser = () => tap
    const rendered = render(fixture(true, getAnalyser))
    const canvas = rendered.container.querySelector('canvas')!
    await waitFor(() => expect(canvas.width).toBeGreaterThan(0))
    const idle = canvas.toDataURL()
    tap = first.analyser
    await waitFor(() => expect(first.spectrum).toHaveBeenCalled())
    expect(canvas.toDataURL()).not.toBe(idle)
    tap = second.analyser
    await waitFor(() => expect(second.spectrum).toHaveBeenCalled())
    rendered.rerender(fixture(false, getAnalyser))
    const stoppedCalls = second.spectrum.mock.calls.length
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    expect(second.spectrum).toHaveBeenCalledTimes(stoppedCalls)
    expect(rendered.getByText('PRESS PLAY TO VISUALIZE')).toBeVisible()
  })

  it('caches drawing styles between frames and redraws inherited theme changes while idle', async () => {
    const gradients = vi.spyOn(CanvasRenderingContext2D.prototype, 'createLinearGradient')
    const { analyser, spectrum } = outputTap()
    const getAnalyser = () => analyser
    const rendered = render(fixture(true, getAnalyser))
    const canvas = rendered.container.querySelector('canvas')!
    await waitFor(() => expect(spectrum).toHaveBeenCalled())
    const initialGradients = gradients.mock.calls.length
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    expect(gradients).toHaveBeenCalledTimes(initialGradients)

    rendered.rerender(fixture(false, getAnalyser))
    await waitFor(() => expect(gradients.mock.calls.length).toBeGreaterThan(initialGradients))
    const idle = canvas.toDataURL()
    rendered.container.style.setProperty('--accent', '#ff0000')
    await waitFor(() => expect(canvas.toDataURL()).not.toBe(idle))
  })

  it('keeps a still canvas when reduced motion is requested', async () => {
    const original = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = original(query)
      if (query === '(prefers-reduced-motion: reduce)') {
        Object.defineProperty(media, 'matches', { value: true })
      }
      return media
    })
    const { analyser, spectrum } = outputTap()
    const rendered = render(fixture(true, () => analyser))
    const canvas = rendered.container.querySelector('canvas')!
    await waitFor(() => expect(canvas.width).toBeGreaterThan(0))
    const still = canvas.toDataURL()
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    expect(canvas.toDataURL()).toBe(still)
    expect(spectrum).not.toHaveBeenCalled()
  })
})
