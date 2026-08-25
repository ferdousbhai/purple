import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PatternEditor } from '@purple/ui/pattern-editor'
import { describe, expect, it, vi } from 'vitest'

const baseProps = {
  getActiveSourceRanges: () => [],
  onEvaluate: () => {},
  playbackHighlightActive: false,
}

describe('PatternEditor in Chromium', () => {
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
        readOnly
        wrapLines
      />,
    )
    expect(content.textContent).toBe('note("c3")')
    expect(content.getAttribute('contenteditable')).not.toBe('true')
    expect(content.classList.contains('cm-lineWrapping')).toBe(true)
    expect(onCodeChange).not.toHaveBeenCalled()

    content.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      ctrlKey: true,
      key: 'Enter',
    }))
    expect(onEvaluate).toHaveBeenCalledOnce()
  })
})
