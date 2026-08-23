/**
 * iOS routes WebAudio through the ringer channel, so the hardware mute
 * switch silences it even though playback runs and the UI animates. Looping
 * a genuinely silent HTML media element during the unlock gesture moves the
 * page's audio session to the media channel, which the switch does not mute.
 * Every iOS browser is WebKit underneath (Chrome included), so this keys off
 * the platform, not the browser.
 */

/** Eight 16-bit samples of silence as a self-contained WAV. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA'

const isIos = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS reports itself as macOS but is the only "Mac" with touch points.
  (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1)

let element: HTMLAudioElement | null = null

/** Call synchronously inside a user gesture, before the first await. */
export function unlockMediaChannel(): void {
  if (element !== null || !isIos()) return
  const audio = new Audio(SILENT_WAV)
  audio.loop = true
  element = audio
  audio.play().catch(() => {
    // Not a user gesture after all; the next activation retries.
    element = null
  })
}
