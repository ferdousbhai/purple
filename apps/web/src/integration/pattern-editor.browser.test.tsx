import { cleanup, render, waitFor } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { PatternEditor } from '@purple/ui/pattern-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'

const baseProps = {
  getActiveSourceRanges: () => [],
  onEvaluate: () => {},
  playbackHighlightActive: false,
}

describe('PatternEditor in Chromium', () => {
  afterEach(cleanup)

  it('edits, evaluates, and accepts controlled code updates', async () => {
    const onCodeChange = vi.fn()
    const onEvaluate = vi.fn()
    const rendered = render(
      <PatternEditor
        {...baseProps}
        code={'s("bd")'}
        onCodeChange={onCodeChange}
        onEvaluate={onEvaluate}
      />,
    )
    const content = rendered.getByRole('textbox', { name: 'Pattern code' })
    const user = userEvent.setup()
    await user.click(content)
    await user.keyboard('{Control>}a{/Control}s("hh")')
    expect(onCodeChange).toHaveBeenLastCalledWith('s("hh")')

    content.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      ctrlKey: true,
      key: 'Enter',
    }))
    expect(onEvaluate).toHaveBeenCalledOnce()

    onCodeChange.mockClear()
    rendered.rerender(
      <PatternEditor
        {...baseProps}
        code={'note("c3")'}
        onCodeChange={onCodeChange}
        onEvaluate={onEvaluate}
      />,
    )
    expect(content.textContent).toBe('note("c3")')
    expect(content.classList.contains('cm-lineWrapping')).toBe(true)
    expect(onCodeChange).not.toHaveBeenCalled()
  })

  it('wraps long patterns without changing code or playback source ranges', async () => {
    const code = 'stack(s("bd ~ bd ~").bank("RolandTR808").gain(.48), note("<c2 ab1 eb2 bb1>/4").s("sine").attack(.03).release(.5).gain(.38), note("<[c4,eb4,g4,bb4] [ab3,c4,eb4,g4]>/4").s("triangle").room(.55)).cpm(24)'
    const onCodeChange = vi.fn()
    const from = code.indexOf('triangle')
    const rendered = render(
      <div style={{ width: 420, height: 300 }}>
        <PatternEditor
          {...baseProps}
          code={code}
          onCodeChange={onCodeChange}
          playbackHighlightActive
          getActiveSourceRanges={() => [[from, from + 'triangle'.length]]}
        />
      </div>,
    )
    const content = rendered.getByRole('textbox', { name: 'Pattern code' })
    const scroller = rendered.container.querySelector('.cm-scroller')!
    await waitFor(() => {
      expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
      expect(content.querySelector('.cm-line')!.getBoundingClientRect().height)
        .toBeGreaterThan(parseFloat(getComputedStyle(content).lineHeight) * 2)
      expect(content.querySelector('.cm-playback-highlight')?.textContent).toBe('triangle')
    })
    expect(content.textContent).toBe(code)
    expect(onCodeChange).not.toHaveBeenCalled()
  })

  it('changes theme without recreating the editor or losing undo history', async () => {
    const originalScheme = document.documentElement.dataset.colorScheme
    document.documentElement.dataset.colorScheme = 'light'
    try {
      const onCodeChange = vi.fn()
      const rendered = render(<PatternEditor {...baseProps} code={'s("bd")'} onCodeChange={onCodeChange} />)
      const content = rendered.getByRole('textbox', { name: 'Pattern code' })
      const editor = rendered.container.querySelector('.cm-editor')!
      const lightTheme = editor.className
      const user = userEvent.setup()
      await user.click(content)
      await user.keyboard('{Control>}a{/Control}s("hh")')
      document.documentElement.dataset.colorScheme = 'dark'
      await waitFor(() => expect(editor.className).not.toBe(lightTheme))
      expect(rendered.getByRole('textbox', { name: 'Pattern code' })).toBe(content)
      expect(content.textContent).toBe('s("hh")')
      await user.keyboard('{Control>}z{/Control}')
      expect(content.textContent).toBe('s("bd")')
    } finally {
      if (originalScheme === undefined) delete document.documentElement.dataset.colorScheme
      else document.documentElement.dataset.colorScheme = originalScheme
    }
  })

})
