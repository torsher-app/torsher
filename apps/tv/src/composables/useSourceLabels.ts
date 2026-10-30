import type {
  AudioTrack,
  SeasonRelease,
  SourceCandidate,
  TitleProgress,
} from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { isFollowAudio } from '../lib/follow.ts'
import {
  formatSize,
  sizeOf,
  trackLanguages,
  videoClassLabel,
} from '../lib/sources.ts'

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

  /** Дорожка из названия раздачи: студия, тип перевода или код языка («UK») */
  function trackLabel(track: AudioTrack) {
    if (track.studio)
      return track.studio

    if (track.type)
      return t(`sources.voiceTypes.${track.type}`)

    return track.language ? track.language.toUpperCase() : ''
  }

  /**
   * Дорожки раздачи, когда язык озвучки дома не русский: «Английская,
   * Оригинал». Пусто — в названии дорожек нет, и это не изъян раздачи.
   */
  function tracksLabel(tracks: AudioTrack[]) {
    return trackLanguages(tracks)
      .map(language =>
        isFollowAudio(language)
          ? t(`audioLanguages.${language}`)
          : language.toUpperCase(),
      )
      .join(', ')
  }

  /** Остальные дорожки раздачи, кроме основной: «ещё: Любительский, UK» */
  function otherTracksLine(candidate: SourceCandidate) {
    const main = candidate.voice
    const others = candidate.audio
      .filter(
        track =>
          !main
          || track.studio !== main.studio
          || track.type !== main.type
          || track.language !== main.language,
      )
      .map(trackLabel)
      .filter(Boolean)

    return others.length > 0
      ? t('sources.alsoVoices', { list: others.join(', ') })
      : ''
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

  /** Раздача сезона без сидов: «1080p · LostFilm» */
  function releaseLine(
    release: Pick<SeasonRelease, 'quality'> & { voice: SeasonRelease['voice'] },
  ) {
    return [
      release.quality && videoClassLabel(release.quality),
      release.voice && voiceLabel(release.voice),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  /**
   * Последний просмотр — одна строка на карточке и в «Источниках»:
   * «S2E1 · 1080p · LostFilm», и раздача, которой смотрели.
   */
  function historyOf(progress: TitleProgress | undefined) {
    const last = progress?.last

    if (!last)
      return undefined

    const release = progress.seasonReleases.find(
      item => item.season === (last.season ?? 0),
    )

    return {
      line: [
        last.season && last.episode ? `S${last.season}E${last.episode}` : '',
        release ? releaseLine(release) : '',
      ]
        .filter(Boolean)
        .join(' · '),
      torrentId: release?.torrentId,
      season: last.season,
      episode: last.episode,
    }
  }

  return {
    voiceLabel,
    tracksLabel,
    otherTracksLine,
    sizeLabel,
    candidateSize,
    seedersLabel,
    releaseLine,
    historyOf,
  }
}
