import type { Ref } from 'vue'
import type { TimedCue } from '../lib/tracks.ts'
import { computed, onScopeDispose, shallowRef } from 'vue'
import { api } from '../api.ts'
import { activeCues, subtitleHtml } from '../lib/tracks.ts'

// Реплики приходят окнами вперёд от позиции: встроенные сервер копит по ходу
// перепаковки, поэтому окно перечитывается
const POLL_MS = 5000

/**
 * Субтитры от сервера: реплики WebVTT приходят JSON и рисуются своим слоем
 * экрана плеера, а не системной дорожкой `<video>` — её положение и вид на
 * ТВ не управляются, и она наезжает на OSD. Так одинаково работают внешние
 * файлы раздачи и встроенные дорожки, которые сервер вынимает при
 * перепаковке.
 */
export function useSubtitles(
  video: Ref<HTMLVideoElement | undefined>,
  position: Ref<number>,
) {
  const cues = shallowRef<TimedCue[]>([])
  let current: { sessionId: string, trackId: string } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let known = new Set<string>()
  let loading = false

  const html = computed(() =>
    activeCues(cues.value, position.value)
      .map(cue => subtitleHtml(cue.text))
      .join('<br>'),
  )

  async function load() {
    const el = video.value
    const target = current

    if (!el || !target || loading)
      return

    loading = true

    try {
      const response = await api.playback.getPlaybackSubtitles(
        target.sessionId,
        target.trackId,
        { from: String(Math.floor(el.currentTime)) },
      )

      // Пока ждали ответ, выбрали другую дорожку
      if (target !== current)
        return

      const fresh = response.cues.filter((cue) => {
        const key = `${cue.start}|${cue.text}`

        if (known.has(key))
          return false

        known.add(key)
        return true
      })

      if (fresh.length > 0) {
        cues.value = [...cues.value, ...fresh].sort(
          (a, b) => a.start - b.start,
        )
      }
    }
    catch {
      // Пропущенное окно дочитается следующим запросом
    }
    finally {
      loading = false
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      void load().then(() => {
        if (current)
          schedule()
      })
    }, POLL_MS)
  }

  function onSeeked() {
    void load()
  }

  function hide() {
    clearTimeout(timer)
    current = null
    cues.value = []
    known = new Set()
    video.value?.removeEventListener('seeked', onSeeked)
  }

  function show(sessionId: string, trackId: string) {
    hide()

    const el = video.value

    if (!el)
      return

    current = { sessionId, trackId }
    el.addEventListener('seeked', onSeeked)
    void load()
    schedule()
  }

  onScopeDispose(hide)

  return { show, hide, html }
}
