/**
 * iOS routes WebAudio through an ambient session by default, so the hardware
 * mute switch can silence it even though playback runs and the UI animates.
 * Modern WebKit exposes AudioSession; older releases need a looping silent
 * media element to move the page onto the playback channel. Every iOS browser
 * is WebKit underneath (Chrome included), so this keys off the platform.
 */

/** Eight 16-bit samples of silence as a self-contained WAV. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA'

interface MediaNavigator {
  userAgent: string
  maxTouchPoints: number
  audioSession?: { type: string }
}

const isIos = (client: MediaNavigator): boolean =>
  /iPad|iPhone|iPod/.test(client.userAgent) ||
  // iPadOS reports itself as macOS but is the only "Mac" with touch points.
  (client.userAgent.includes('Mac') && client.maxTouchPoints > 1)

let element: HTMLAudioElement | null = null

/** Prefer WebKit's explicit playback category so Silent Mode does not mute music. */
export function enableIosPlaybackSession(client: MediaNavigator = navigator): boolean {
  if (!isIos(client) || !client.audioSession) return false
  try {
    client.audioSession.type = 'playback'
    return client.audioSession.type === 'playback'
  } catch {
    return false
  }
}

/** Call synchronously inside a user gesture, before the first await. */
export function unlockMediaChannel(): void {
  if (enableIosPlaybackSession()) return
  if (element !== null || !isIos(navigator)) return
  const audio = new Audio(SILENT_WAV)
  audio.loop = true
  element = audio
  audio.play().catch(() => {
    // Not a user gesture after all; the next activation retries.
    element = null
  })
}
