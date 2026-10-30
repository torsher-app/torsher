import type { Follow } from '../../db/schema.ts'
import type { VoiceRef } from '../sources/profile.ts'
import { getPinnedVoice } from '../sources/voices.ts'
import { followAudio } from './audio.ts'

/**
 * Своя студия сезона: закрепление сезона, иначе ближайшего прошлого сезона
 * («как в прошлых сериях» переходит в новый), иначе студия из правил.
 * Студии есть только у русской озвучки: в остальных режимах своей нет, а
 * закрепления прошлых сезонов ждут возврата к русскому.
 */
export function seasonVoice(
  follow: Follow,
  season: number,
): VoiceRef | undefined {
  if (followAudio(follow) !== 'ru')
    return undefined

  for (let number = season; number >= (season > 0 ? 1 : 0); number--) {
    const pinned = getPinnedVoice(follow.titleId, number)

    if (pinned)
      return pinned
  }

  return follow.voiceStudio ? { studio: follow.voiceStudio } : undefined
}
