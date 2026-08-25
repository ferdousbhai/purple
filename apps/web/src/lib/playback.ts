import { unlockMediaChannel } from '#/lib/media-channel'
import { defaultEnsureRunningContext } from '@purple/ui/use-strudel'
import type { usePlayback } from '@purple/ui/use-playback'

export type WebPlayback = ReturnType<typeof usePlayback>

/** Runs inside the unlock gesture, before the first await. iOS refuses the
 * media-channel element when activation is deferred past the click. */
export const WEB_AUDIO_OPTIONS = {
  async ensureRunningContext(context: AudioContext) {
    unlockMediaChannel()
    await defaultEnsureRunningContext(context)
  },
}
