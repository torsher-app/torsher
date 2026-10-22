import type Hls from 'hls.js'
import { onScopeDispose } from 'vue'

const HLS_NATIVE = 'application/vnd.apple.mpegurl'
// Так сервер отвечает, когда перепаковка сегмента не удалась
const TRANSCODE_FAILED = 502

/**
 * Поток перепаковки: hls.js на MSE, а где его нет — нативный HLS. hls.js
 * грузится отдельным чанком только для перепаковки: прямое воспроизведение
 * его не тянет. Свежий Chrome отвечает на HLS «maybe», но играет не всё —
 * поэтому сначала hls.js.
 */
export function useHls(onFatal: () => void) {
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
      // 502 — ffmpeg не прочитал вход (битые или пустые данные): повторы
      // дадут то же самое, а зритель минуту смотрел бы на буферизацию
      if (
        data.details === HlsPlayer.ErrorDetails.FRAG_LOAD_ERROR
        && data.response?.code === TRANSCODE_FAILED
      ) {
        detach()
        onFatal()
        return
      }

      if (!data.fatal)
        return

      if (data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR)
        player.recoverMediaError()
      else onFatal()
    })
    player.loadSource(url)
    player.attachMedia(video)
    hls = player

    return true
  }

  onScopeDispose(detach)

  return { attach, detach }
}
