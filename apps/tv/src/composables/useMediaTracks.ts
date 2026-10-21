import type { Ref } from 'vue'
import type { TrackOption } from '../components/player/PlayerTracks.vue'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

// `audioTracks` в типах DOM нет: в Chromium он за флагом, на ТВ — как отдаст платформа
interface AudioTrackLike {
  id: string
  label: string
  language: string
  enabled: boolean
}

interface AudioTrackListLike {
  readonly length: number
  [index: number]: AudioTrackLike
}

type MediaWithAudio = HTMLVideoElement & { audioTracks?: AudioTrackListLike }

function listOf<T>(list: { length: number, [index: number]: T } | undefined) {
  const items: T[] = []

  for (let i = 0; i < (list?.length ?? 0); i++) items.push(list![i]!)

  return items
}

const OFF = 'off'

/**
 * Дорожки, которые отдаёт сама платформа. Кнопки «Аудио» и «Субтитры»
 * показываются, только если выбирать есть из чего; выбор дорожек на сервере
 * появится вместе с remux.
 */
export function useMediaTracks(video: Ref<HTMLVideoElement | undefined>) {
  const { t } = useI18n()
  const audio = shallowRef<AudioTrackLike[]>([])
  const text = shallowRef<TextTrack[]>([])

  function labelOf(track: { label: string, language: string }, index: number) {
    return track.label || track.language || t('player.track', { n: index + 1 })
  }

  function refresh() {
    const el = video.value as MediaWithAudio | undefined

    audio.value = listOf(el?.audioTracks)
    text.value = listOf(el?.textTracks).filter(
      track => track.kind === 'subtitles' || track.kind === 'captions',
    )
  }

  const audioOptions = computed<TrackOption[]>(() =>
    audio.value.map((track, index) => ({
      id: String(index),
      label: labelOf(track, index),
      selected: track.enabled,
    })),
  )

  const subtitleOptions = computed<TrackOption[]>(() => [
    {
      id: OFF,
      label: t('player.subtitlesOff'),
      selected: text.value.every(track => track.mode !== 'showing'),
    },
    ...text.value.map((track, index) => ({
      id: String(index),
      label: labelOf(track, index),
      selected: track.mode === 'showing',
    })),
  ])

  const audioLabel = computed(() =>
    audio.value.length > 1
      ? (audioOptions.value.find(option => option.selected)?.label ?? '')
      : null,
  )

  const subtitlesLabel = computed(() =>
    text.value.length > 0
      ? (subtitleOptions.value.find(option => option.selected)?.label ?? '')
      : null,
  )

  function selectAudio(id: string) {
    audio.value.forEach((track, index) => {
      track.enabled = String(index) === id
    })
    refresh()
  }

  function selectSubtitles(id: string) {
    text.value.forEach((track, index) => {
      track.mode = String(index) === id ? 'showing' : 'disabled'
    })
    refresh()
  }

  return {
    refresh,
    audioOptions,
    subtitleOptions,
    audioLabel,
    subtitlesLabel,
    selectAudio,
    selectSubtitles,
  }
}
