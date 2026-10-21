import type { AudioTrack, SourceCandidate } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { formatSize, sizeOf } from '../lib/sources.ts'

/** Подписи раздач и озвучки: общие для кнопки карточки, листа и панели */
export function useSourceLabels() {
  const { t, locale } = useI18n()

  function voiceLabel(
    voice: Pick<AudioTrack, 'studio' | 'type'> | null | undefined,
  ) {
    if (!voice)
      return t('sources.noVoice')

    if (voice.studio)
      return voice.studio

    return voice.type
      ? t(`sources.voiceTypes.${voice.type}`)
      : t('sources.noVoice')
  }

  function sizeLabel(bytes: number) {
    const { amount, unit } = formatSize(bytes, locale.value)

    return t(`sources.units.${unit}`, { amount })
  }

  /** Размер на серию, если он известен, иначе вся раздача */
  function candidateSize(candidate: SourceCandidate) {
    const size = sizeOf(candidate)

    if (size === null)
      return ''

    return candidate.episodeSize !== null && candidate.isPack
      ? t('sources.perEpisode', { size: sizeLabel(size) })
      : sizeLabel(size)
  }

  function seedersLabel(count: number) {
    return t('sources.seeders', count)
  }

  /** «1080p · LostFilm · 42 сида» для второй строки главной кнопки */
  function bestLine(candidate: SourceCandidate) {
    return [
      candidate.quality,
      candidate.voice && voiceLabel(candidate.voice),
      seedersLabel(candidate.seeders),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return { voiceLabel, sizeLabel, candidateSize, seedersLabel, bestLine }
}
