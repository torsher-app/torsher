import type { VideoStreamInfo } from './probe.ts'

/** Чем кодируется H.264: процессором или видеокартой */
export type VideoEncoder = 'software' | 'vaapi' | 'nvenc'

/** Как переводится HDR в SDR: на видеокарте (`libplacebo`) или процессором */
export type ToneMapping = 'gpu' | 'software'

/** Что умеет сервер, по детекту ускорения (`accel.ts`) */
export interface EncoderCaps {
  encoder: VideoEncoder
  /** VAAPI: устройство `/dev/dri/renderD*` */
  device: string | null
  /** VAAPI только в режиме low-power (VDEnc): так у свободного драйвера Intel */
  lowPower: boolean
  /** Что видеокарта декодирует сама: ключи `decodeKeyOf` */
  decode: string[]
  /** Потолок высоты кадра на выходе */
  maxHeight: number
  /** Перевод HDR в SDR; null — фильтров нет */
  toneMapping: ToneMapping | null
  /** Потолок высоты кадра для HDR: перевод в SDR дороже кодирования */
  toneMappingMaxHeight: number
}

export interface EncodePlan {
  encoder: VideoEncoder
  device: string | null
  lowPower: boolean
  /** Декодирует видеокарта: кадры сразу в её памяти */
  hwDecode: boolean
  highBitDepth: boolean
  /** Размер на выходе, чётный */
  width: number
  height: number
  /** Размер меняется: выше потолка или пиксели не квадратные */
  scale: boolean
  deinterlace: boolean
  /** HDR → SDR; null — исходник SDR или перевести нечем */
  toneMapping: ToneMapping | null
  /** HDR, который перевести нечем: цвета будут бледными */
  hdrUntouched: boolean
  /** бит/с: потолок битрейта кодировщика */
  bitrate: number
  frameRate: number
  /** Графические субтитры (номер потока), которые прожигаются в кадр */
  burnSubtitle: number | null
  /** Что пробовать, если этот вариант не запустился: проще, вплоть до процессора */
  fallback: EncodePlan | null
}

/** Ключ кодека для списка того, что декодирует видеокарта: `hevc10`, `h264` */
export function decodeKeyOf(
  video: Pick<VideoStreamInfo, 'codec' | 'highBitDepth'>,
) {
  return `${video.codec}${video.highBitDepth ? '10' : ''}`
}

// Потолок битрейта по высоте кадра: для локальной сети с запасом
function bitrateCap(height: number) {
  if (height > 720)
    return 10_000_000

  if (height > 576)
    return 5_000_000

  return 2_500_000
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)

/**
 * Размер кадра на выходе: пропорции экрана исходника (с учётом формы пикселя)
 * в пределах потолка по высоте и ширины 16:9 того же потолка.
 */
export function outputSize(video: VideoStreamInfo, maxHeight: number) {
  const height = video.height ?? maxHeight
  const width
    = (video.width ?? Math.round((height * 16) / 9)) * video.pixelAspect
  const maxWidth = Math.round((maxHeight * 16) / 9)
  const ratio = Math.min(1, maxHeight / height, maxWidth / width)

  return { width: even(width * ratio), height: even(height * ratio) }
}

/** План перекодирования видео: кодировщик, фильтры, размер, битрейт */
export function planEncode(
  video: VideoStreamInfo,
  caps: EncoderCaps,
  burnSubtitle: number | null,
  software: EncoderCaps | null,
): EncodePlan {
  const toneMapping = video.hdr ? caps.toneMapping : null
  const { width, height } = outputSize(
    video,
    toneMapping
      ? Math.min(caps.maxHeight, caps.toneMappingMaxHeight)
      : caps.maxHeight,
  )
  const hwDecode
    = caps.encoder !== 'software' && caps.decode.includes(decodeKeyOf(video))
  const plan: EncodePlan = {
    encoder: caps.encoder,
    device: caps.device,
    lowPower: caps.lowPower,
    hwDecode,
    highBitDepth: video.highBitDepth,
    width,
    height,
    scale: width !== video.width || height !== video.height,
    deinterlace: video.interlaced,
    toneMapping,
    hdrUntouched: video.hdr && !toneMapping,
    bitrate: Math.min(video.bitrate ?? Infinity, bitrateCap(height)),
    frameRate: video.frameRate ?? 25,
    burnSubtitle,
    fallback: null,
  }

  // Откат: сначала без декодирования на видеокарте, затем процессором
  const last
    = caps.encoder !== 'software' && software
      ? planEncode(video, software, burnSubtitle, null)
      : null

  plan.fallback = hwDecode
    ? { ...plan, hwDecode: false, fallback: last }
    : last

  return plan
}

/** Строка для журнала: `vaapi+decode, 1280x720, tonemap=gpu` */
export function describePlan(plan: EncodePlan) {
  return [
    plan.encoder + (plan.hwDecode ? '+decode' : ''),
    `${plan.width}x${plan.height}`,
    plan.deinterlace && 'deinterlace',
    plan.toneMapping && `tonemap=${plan.toneMapping}`,
    plan.hdrUntouched && 'hdr-untouched',
    plan.burnSubtitle !== null && `burn=s${plan.burnSubtitle}`,
  ]
    .filter(Boolean)
    .join(', ')
}

// Перевод в SDR процессором — апстрим ffmpeg (`libzimg`): в линейный свет,
// цвета BT.709, кривая hable, обратно в BT.709 ограниченного диапазона
export function softwareToneMap(width: number, height: number) {
  return [
    `zscale=w=${width}:h=${height}:t=linear:npl=100`,
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ]
}

// libplacebo без устройства в графе сам создаёт Vulkan на видеокарте.
// Кривая BT.2390, как у Jellyfin; без подстройки под пик яркости: она дорогая
// и начиналась бы заново с каждым запуском ffmpeg — яркость скакала бы на
// стыках сегментов после перемотки
export function gpuToneMap(width: number, height: number) {
  return [
    `libplacebo=w=${width}:h=${height}:tonemapping=bt.2390:peak_detect=0:dithering=none:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p`,
  ]
}

const HW_DEVICE = 'hw'

/** Аргументы до входа: устройство видеокарты и её декодер */
export function encodeInputArgs(plan: EncodePlan) {
  if (plan.encoder === 'software')
    return []

  const vaapi = plan.encoder === 'vaapi'
  const device = vaapi
    ? `vaapi=${HW_DEVICE}:${plan.device ?? '/dev/dri/renderD128'}`
    : `cuda=${HW_DEVICE}:0`

  return [
    '-init_hw_device',
    device,
    '-filter_hw_device',
    HW_DEVICE,
    ...(plan.hwDecode
      ? [
          '-hwaccel',
          vaapi ? 'vaapi' : 'cuda',
          '-hwaccel_device',
          HW_DEVICE,
          '-hwaccel_output_format',
          vaapi ? 'vaapi' : 'cuda',
        ]
      : []),
  ]
}

/**
 * Граф фильтров видео: деинтерлейс, HDR → SDR, масштаб, субтитры. Кадры
 * переходят между памятью видеокарты и процессора только там, где фильтру
 * нужна другая: перевод в SDR и наложение субтитров идут в памяти процессора.
 */
export function encodeFilterGraph(plan: EncodePlan, videoStream: number) {
  const { width, height } = plan
  const chain: string[] = []
  let onGpu = plan.hwDecode
  let scaled = false

  const gpuScale = (format: string) =>
    plan.encoder === 'vaapi'
      ? `scale_vaapi=w=${width}:h=${height}:format=${format}`
      : `scale_cuda=w=${width}:h=${height}:format=${format}`

  // Выгрузка из видеокарты — после уменьшения: кадр 4K в 10 бит, выгруженный
  // целиком, на N150 перекодировался втрое медленнее просмотра
  const download = () => {
    if (!onGpu)
      return

    const format = plan.highBitDepth ? 'p010le' : 'nv12'

    if (plan.scale && !scaled) {
      chain.push(gpuScale(format))
      scaled = true
    }

    chain.push('hwdownload', `format=${format}`)
    onGpu = false
  }

  if (plan.deinterlace) {
    if (onGpu)
      chain.push(plan.encoder === 'vaapi' ? 'deinterlace_vaapi' : 'yadif_cuda')
    else chain.push('yadif')
  }

  if (plan.toneMapping) {
    download()
    chain.push(
      ...(plan.toneMapping === 'gpu'
        ? gpuToneMap(width, height)
        : softwareToneMap(width, height)),
    )
    scaled = true
  }

  if (plan.burnSubtitle !== null) {
    download()

    if (!scaled && plan.scale)
      chain.push(`scale=${width}:${height}`)

    chain.push('format=yuv420p')
    scaled = true
  }

  // На видеокарте масштаб ещё и переводит 10 бит в 8: он нужен всегда
  if (onGpu)
    chain.push(gpuScale('nv12'))
  else if (!scaled && plan.scale)
    chain.push(`scale=${width}:${height}`)

  const tail: string[] = []

  if (!onGpu) {
    if (plan.encoder === 'vaapi')
      tail.push('format=nv12', 'hwupload')
    // NVENC берёт кадры из памяти процессора сам
    else if (plan.encoder === 'nvenc')
      tail.push('format=nv12')
    else tail.push('format=yuv420p')
  }

  const source = `[0:${videoStream}]`
  // Перевод в SDR уже кончается тем же форматом, что нужен кодировщику
  const filters = (list: string[]) =>
    list.filter((filter, i) => filter !== list[i - 1]).join(',')

  if (plan.burnSubtitle === null)
    return `${source}${filters([...chain, ...tail])}[v]`

  // Субтитры растягиваются на кадр выхода: холст PGS и VobSub — кадр исходника
  return [
    `${source}${filters(chain)}[base]`,
    `[0:${plan.burnSubtitle}]scale=${width}:${height}[sub]`,
    `[base][sub]${['overlay=eof_action=pass:repeatlast=0', ...tail].join(',')}[v]`,
  ].join(';')
}

/**
 * Кодировщик и ключевые кадры. Ключевой кадр ставится на начало каждого
 * сегмента (`keyframes` — абсолютное время файла: запуск идёт с `-copyts`),
 * иначе сегмент-муксер не разрежет поток по границам плейлиста.
 */
export function encodeOutputArgs(plan: EncodePlan, keyframes: number[]) {
  const rate = String(Math.round(plan.bitrate))
  const buffer = String(Math.round(plan.bitrate * 2))
  const args: string[] = []

  if (plan.encoder === 'vaapi') {
    args.push(
      '-c:v',
      'h264_vaapi',
      ...(plan.lowPower ? ['-low_power', '1'] : []),
      '-rc_mode',
      'VBR',
      '-b:v',
      rate,
      '-maxrate',
      rate,
      '-bufsize',
      buffer,
      '-profile:v',
      'high',
    )
  }
  else if (plan.encoder === 'nvenc') {
    // NVENC может пропустить принудительный кадр: GOP 2 с совпадает с
    // разрезами сам — границы сегментов 2 + 6k кратны двум секундам
    args.push(
      '-c:v',
      'h264_nvenc',
      '-preset',
      'p4',
      '-rc',
      'vbr',
      '-b:v',
      rate,
      '-maxrate',
      rate,
      '-bufsize',
      buffer,
      '-profile:v',
      'high',
      '-forced-idr',
      '1',
      '-g',
      String(Math.max(1, Math.round(plan.frameRate * 2))),
    )
  }
  else {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-maxrate',
      rate,
      '-bufsize',
      buffer,
      '-profile:v',
      'high',
      '-x264opts',
      'subme=0:me_range=16:rc_lookahead=10:me=hex:open_gop=0',
      // Иначе x264 поставит ключевой кадр на смене сцены и сломает разрез
      '-sc_threshold',
      '0',
    )
  }

  args.push(
    // Пиксели на выходе квадратные: размер уже в пропорциях экрана
    '-aspect',
    `${plan.width}:${plan.height}`,
    '-force_key_frames',
    keyframes.map(time => time.toFixed(3)).join(','),
  )

  return args
}
