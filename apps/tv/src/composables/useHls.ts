import type Hls from 'hls.js'
import { onScopeDispose } from 'vue'
import { mediaErrorAction } from '../lib/player.ts'

const HLS_NATIVE = 'application/vnd.apple.mpegurl'
// Так сервер отвечает, когда перепаковка сегмента не удалась
const TRANSCODE_FAILED = 502

/**
 * Почему поток встал: `network` — сеть, сервер или перепаковка, пройдёт
 * повтором; `media` — сегменты не разбираются; `other` — прочее.
 */
export type HlsFailure = 'network' | 'media' | 'other'

/**
 * Поток перепаковки: hls.js на MSE, а где его нет — нативный HLS. hls.js
 * грузится отдельным чанком только для перепаковки: прямое воспроизведение
 * его не тянет. Свежий Chrome отвечает на HLS «maybe», но играет не всё —
 * поэтому сначала hls.js.
 */
export function useHls(onFatal: (kind: HlsFailure, detail?: string) => void) {
  let hls: Hls | undefined

  function detach() {
    hls?.destroy()
    hls = undefined
  }

  async function attach(video: HTMLVideoElement, url: string, start: number) {
    detach()

    const { default: HlsPlayer } = await import('hls.js')

    if (!HlsPlayer.isSupported()) {
      if (video.canPlayType(HLS_NATIVE) === '')
        return false

      video.src = url
      return true
    }

    let mediaErrors: number[] = []
    const player = new HlsPlayer({
      startPosition: start,
      // Сервер отдаёт сегмент, когда ffmpeg его допишет: у свежей раздачи —
      // через десятки секунд
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 70_000,
          maxLoadTimeMs: 120_000,
          timeoutRetry: {
            maxNumRetry: 4,
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
          errorRetry: {
            maxNumRetry: 6,
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
        },
      },
      // Память ТВ ограничена: позади держим немного
      backBufferLength: 30,
      maxBufferLength: 60,
    })

    player.on(HlsPlayer.Events.ERROR, (_event, data) => {
      // 502 — ffmpeg упал или не прочитал вход: повторы hls.js в той же
      // сессии дадут то же самое, а новая сессия запустит новый ffmpeg
      if (
        data.details === HlsPlayer.ErrorDetails.FRAG_LOAD_ERROR
        && data.response?.code === TRANSCODE_FAILED
      ) {
        detach()
        onFatal('network')
        return
      }

      if (!data.fatal)
        return

      if (data.type !== HlsPlayer.ErrorTypes.MEDIA_ERROR) {
        onFatal(
          data.type === HlsPlayer.ErrorTypes.NETWORK_ERROR
            ? 'network'
            : 'other',
          data.details,
        )
        return
      }

      const now = Date.now()
      const action = mediaErrorAction(mediaErrors, now)

      mediaErrors = [...mediaErrors, now].slice(-2)

      if (action === 'fail') {
        detach()
        onFatal('media', data.details)
        return
      }

      if (action === 'swapAndRecover')
        player.swapAudioCodec()
      player.recoverMediaError()
    })
    player.loadSource(url)
    player.attachMedia(video)
    hls = player

    return true
  }

  onScopeDispose(detach)

  return { attach, detach }
}
