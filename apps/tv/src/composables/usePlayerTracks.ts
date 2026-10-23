import type {
  MediaAudioTrack,
  MediaSubtitleTrack,
  Playback,
} from '@torsher/api-client'
import type { Ref, ShallowRef } from 'vue'
import type { TrackOption } from '../components/player/PlayerTracks.vue'
import type { PlaybackRestart } from './usePlayback.ts'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  audioOrder,
  channelsLabel,
  codecLabel,
  kilobits,
} from '../lib/tracks.ts'
import { useMediaTracks } from './useMediaTracks.ts'
import { useSubtitles } from './useSubtitles.ts'

const OFF = 'off'

interface AudioTrackLike {
  enabled: boolean
}

type MediaWithAudio = HTMLVideoElement & {
  audioTracks?: { length: number, [index: number]: AudioTrackLike }
}

/**
 * Озвучка и субтитры плеера. Дорожки знает сервер (`media` сессии): озвучку
 * плеер меняет сам, если умеет (`audioSwitch: platform`), иначе — новый поток
 * с этой дорожкой с текущего места. Без `media` (на сервере нет ffmpeg) —
 * дорожки, которые отдаёт сама платформа.
 */
export function usePlayerTracks(
  playback: ShallowRef<Playback | undefined>,
  video: Ref<HTMLVideoElement | undefined>,
  position: Ref<number>,
  restart: (change: PlaybackRestart) => void,
) {
  const { t, te } = useI18n()
  const platform = useMediaTracks(video)
  const subtitles = useSubtitles(video, position)
  const audioStream = ref<number | null>(null)
  const subtitle = ref<string | null>(null)
  const media = computed(() => playback.value?.media ?? null)

  // Графические субтитры уже в кадре: реплик для слоя у них нет
  const burnedIn = (id: string | null) =>
    !!id && !!media.value?.subtitles.find(track => track.id === id)?.burnIn

  watch(playback, (value) => {
    audioStream.value = value?.audioStream ?? null
    subtitle.value = value?.subtitle ?? null

    if (
      value?.status === 'ready'
      && value.subtitle
      && !burnedIn(value.subtitle)
    ) {
      subtitles.show(value.sessionId, value.subtitle)
    }
    else {
      subtitles.hide()
    }
  })

  function languageName(code: string | null) {
    if (!code)
      return null

    return te(`languages.${code}`)
      ? t(`languages.${code}`)
      : code.toUpperCase()
  }

  function audioTitle(track: MediaAudioTrack, position: number) {
    const name = track.studio ?? track.title
    const parts = [languageName(track.language), name].filter(
      (part, i, all): part is string => !!part && all.indexOf(part) === i,
    )

    return parts.join(' · ') || t('player.track', { n: position + 1 })
  }

  function audioDetail(track: MediaAudioTrack) {
    const rate = kilobits(track.bitrate)

    return [
      track.voiceType ? t(`sources.voiceTypes.${track.voiceType}`) : null,
      codecLabel(track.codec),
      channelsLabel(track.channels),
      rate ? t('player.kbps', { n: rate }) : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  function subtitleTitle(track: MediaSubtitleTrack, position: number) {
    return (
      [languageName(track.language), track.title].filter(Boolean).join(' · ')
      || t('player.track', { n: position + 1 })
    )
  }

  function subtitleDetail(track: MediaSubtitleTrack) {
    return [
      track.external ? t('player.subtitleFile') : null,
      track.burnIn ? t('player.subtitleBurnIn') : null,
      track.forced ? t('player.forced') : null,
      codecLabel(track.codec),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const audioOptions = computed<TrackOption[]>(() =>
    media.value
      ? media.value.audio.map((track, i) => ({
          id: String(track.index),
          label: audioTitle(track, i),
          detail: audioDetail(track),
          selected: track.index === audioStream.value,
        }))
      : platform.audioOptions.value,
  )

  const subtitleOptions = computed<TrackOption[]>(() =>
    media.value
      ? [
          {
            id: OFF,
            label: t('player.subtitlesOff'),
            selected: subtitle.value === null,
          },
          ...media.value.subtitles.map((track, i) => ({
            id: track.id,
            label: subtitleTitle(track, i),
            detail: subtitleDetail(track),
            selected: track.id === subtitle.value,
          })),
        ]
      : platform.subtitleOptions.value,
  )

  /** Вторая строка кнопки «Аудио»: студия или язык; null — выбирать не из чего */
  const audioLabel = computed(() => {
    if (!media.value)
      return platform.audioLabel.value

    if (media.value.audio.length < 2)
      return null

    const track = media.value.audio.find(
      item => item.index === audioStream.value,
    )

    return track
      ? (track.studio ?? languageName(track.language) ?? track.title ?? '')
      : ''
  })

  const subtitlesLabel = computed(() => {
    if (!media.value)
      return platform.subtitlesLabel.value

    if (media.value.subtitles.length === 0)
      return null

    return subtitleOptions.value.find(option => option.selected)?.label ?? ''
  })

  /** Переключить озвучку в самом `<video>`: дорожки идут в порядке файла */
  function switchInPlace(index: number) {
    const tracks = (video.value as MediaWithAudio | undefined)?.audioTracks
    const all = media.value?.audio ?? []
    const order = audioOrder(all, index)

    if (!tracks || tracks.length !== all.length || order < 0)
      return false

    for (let i = 0; i < tracks.length; i++) tracks[i]!.enabled = i === order

    return true
  }

  function canSwitchInPlace() {
    const current = playback.value

    return current?.mode === 'direct' && current.audioSwitch === 'platform'
  }

  /**
   * После `loadedmetadata`. Новый `src` включает дорожку по умолчанию, а
   * выбрана может быть другая: запомненная сервером или переключённая на
   * месте до повтора.
   */
  function refresh() {
    platform.refresh()

    if (media.value && audioStream.value !== null && canSwitchInPlace())
      switchInPlace(audioStream.value)
  }

  function selectAudio(id: string) {
    const current = playback.value

    if (!media.value || !current)
      return platform.selectAudio(id)

    const index = Number(id)

    if (index === audioStream.value)
      return

    if (canSwitchInPlace() && switchInPlace(index)) {
      audioStream.value = index
      return
    }

    restart({ audioStream: index, subtitle: subtitle.value ?? undefined })
  }

  function selectSubtitles(id: string) {
    const current = playback.value

    if (!media.value || !current)
      return platform.selectSubtitles(id)

    const track = media.value.subtitles.find(item => item.id === id)

    if ((id !== OFF && !track) || id === (subtitle.value ?? OFF))
      return

    // Прожиг в кадр включает и снимает только новый поток
    if (burnedIn(subtitle.value) || track?.burnIn) {
      restart({
        audioStream: audioStream.value ?? undefined,
        subtitle: id === OFF ? undefined : id,
      })
      return
    }

    if (id === OFF || !track) {
      subtitles.hide()
      subtitle.value = null
      return
    }

    // Встроенные субтитры при прямом воспроизведении вынимает только
    // перепаковка: поток перезапускается с ними
    if (!track.external && current.mode === 'direct') {
      restart({ audioStream: audioStream.value ?? undefined, subtitle: id })
      return
    }

    subtitle.value = id
    subtitles.show(current.sessionId, id)
  }

  /** Подзаголовок панели: что за файл играет */
  const caption = computed(() => {
    const info = media.value?.video

    return info
      ? [
          info.height ? `${info.height}p` : null,
          codecLabel(info.codec),
          info.hdr ? 'HDR' : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : ''
  })

  /** Выбранные сейчас дорожки — для нового потока с того же места */
  function selection(): PlaybackRestart {
    return {
      audioStream: audioStream.value ?? undefined,
      subtitle: subtitle.value ?? undefined,
    }
  }

  /** Есть графические субтитры: их выбор перезапускает поток */
  const hasBurnIn = computed(
    () => !!media.value?.subtitles.some(track => track.burnIn),
  )

  return {
    refresh,
    selection,
    hasBurnIn,
    audioOptions,
    subtitleOptions,
    audioLabel,
    subtitlesLabel,
    selectAudio,
    selectSubtitles,
    caption,
    /** Видимые сейчас реплики субтитров сервера, готовый HTML */
    subtitleHtml: subtitles.html,
  }
}
