import { describe, expect, it } from 'vitest'
import { enableIosPlaybackSession } from './media-channel'

describe('iOS media channel', () => {
  it('selects the playback audio session on modern iPhones', () => {
    const audioSession = { type: 'ambient' }

    expect(enableIosPlaybackSession({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
      audioSession,
    })).toBe(true)
    expect(audioSession.type).toBe('playback')
  })

  it('leaves non-iOS audio sessions alone', () => {
    const audioSession = { type: 'ambient' }

    expect(enableIosPlaybackSession({
      userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      maxTouchPoints: 5,
      audioSession,
    })).toBe(false)
    expect(audioSession.type).toBe('ambient')
  })
})
