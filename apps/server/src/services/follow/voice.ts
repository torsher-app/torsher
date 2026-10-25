import type { Follow } from '../../db/schema.ts'
import type { VoiceRef } from '../sources/profile.ts'
import { getPinnedVoice } from '../sources/voices.ts'

/**
 * Своя студия сезона: закрепление сезона, иначе ближайшего прошлого сезона
 * («как в прошлых сериях» переходит в новый), иначе студия из правил.
 */
export function seasonVoice(
  follow: Follow,
  season: number,
): VoiceRef | undefined {
  for (let number = season; number >= (season > 0 ? 1 : 0); number--) {
    const pinned = getPinnedVoice(follow.titleId, number)

    if (pinned)
      return pinned
  }

  return follow.voiceStudio ? { studio: follow.voiceStudio } : undefined
}
