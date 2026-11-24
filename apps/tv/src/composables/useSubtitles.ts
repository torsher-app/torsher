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
  const offsetMs = shallowRef(0)
  let current:
    | {
      sessionId: string
      trackId: string
      video: HTMLVideoElement
    }
    | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: AbortController | undefined
  const known = new Set<string>()
  const effectiveSeconds = computed(
    () => position.value - offsetMs.value / 1000,
  )

  const html = computed(() => {
    const seconds = effectiveSeconds.value
    if (seconds < 0)
      return ''
    return activeCues(cues.value, seconds)
      .map(cue => subtitleHtml(cue.text))
      .join('<br>')
  })

  function loadWindow() {
    const target = current
    if (!target)
      return

    clearTimeout(timer)
    pending?.abort()
    const request = new AbortController()
    pending = request

    void api.playback
      .getPlaybackSubtitles(
        target.sessionId,
        target.trackId,
        { from: String(Math.max(0, Math.floor(effectiveSeconds.value))) },
        { signal: request.signal },
      )
      .then(({ cues: window }) => {
        if (pending !== request || current !== target)
          return
        const fresh = window.filter((cue) => {
          const key = `${cue.start}|${cue.end}|${cue.text}`
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
      })
      .catch(() => {
        // Пропущенное окно дочитается следующим запросом
      })
      .finally(() => {
        if (pending !== request || current !== target)
          return
        pending = undefined
        timer = setTimeout(loadWindow, POLL_MS)
      })
  }

  function hide() {
    clearTimeout(timer)
    pending?.abort()
    pending = undefined
    current?.video.removeEventListener('seeked', loadWindow)
    current = undefined
    cues.value = []
    known.clear()
    offsetMs.value = 0
  }

  function show(sessionId: string, trackId: string, offset = 0) {
    hide()
    const el = video.value
    if (!el)
      return

    current = { sessionId, trackId, video: el }
    offsetMs.value = offset
    el.addEventListener('seeked', loadWindow)
    loadWindow()
  }

  function setOffset(offset: number) {
    if (offsetMs.value === offset)
      return
    offsetMs.value = offset
    loadWindow()
  }

  onScopeDispose(hide)

  return { show, hide, html, setOffset }
}
