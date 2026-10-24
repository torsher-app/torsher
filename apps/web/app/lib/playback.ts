import type { GpuEncoder, PlaybackSettings } from '@torsher/api-client'

/** Раздел README о том, как подключить видеокарту к контейнеру */
export const HARDWARE_DOCS
  = 'https://github.com/torsher-app/torsher#hardware-transcoding'

const CODECS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  vp9: 'VP9',
  av1: 'AV1',
}

const VENDORS: Record<NonNullable<GpuEncoder['vendor']>, string> = {
  intel: 'Intel',
  amd: 'AMD',
  nvidia: 'NVIDIA',
}

/** Ключ декодера сервера (`hevc10`) → кодек и разрядность для подписи */
export function decodeLabelOf(key: string) {
  const deep = key.endsWith('10')
  const codec = deep ? key.slice(0, -2) : key

  return { codec: CODECS[codec] ?? codec.toUpperCase(), deep }
}

/** Производитель для подписи «Видеокарта Intel»; null — не распознан */
export function vendorNameOf(gpu: GpuEncoder) {
  return gpu.vendor ? VENDORS[gpu.vendor] : null
}

/**
 * Что с ускорением, одним словом для текста:
 * - `gpu` — кодирует видеокарта;
 * - `off` — видеокарта есть, но в настройках выбран процессор;
 * - `failed` — устройство видно, но пробное кодирование не прошло;
 * - `none` — видеокарты в контейнере нет, кодирует процессор;
 * - `unavailable` — нет и кодировщика H.264 для процессора.
 */
export type AccelStatus = 'gpu' | 'off' | 'failed' | 'none' | 'unavailable'

export function accelStatusOf(settings: PlaybackSettings): AccelStatus {
  if (settings.encoder === null)
    return 'unavailable'

  if (settings.encoder !== 'software')
    return 'gpu'

  if (settings.gpus.length > 0)
    return 'off'

  return settings.failed.length > 0 ? 'failed' : 'none'
}

/** Видеокарта, которой кодирует сервер, иначе первая найденная */
export function mainGpuOf(settings: PlaybackSettings) {
  return (
    settings.gpus.find(gpu => gpu.encoder === settings.encoder)
    ?? settings.gpus[0]
    ?? null
  )
}

/** Чем переводится HDR в SDR; `none` — фильтров в ffmpeg нет */
export function toneMappingOf(settings: PlaybackSettings) {
  if (settings.gpuToneMapping)
    return 'gpu' as const

  return settings.softwareToneMapping
    ? ('software' as const)
    : ('none' as const)
}
