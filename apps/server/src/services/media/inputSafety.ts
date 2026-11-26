import process from 'node:process'

// Демуксеры всех расширений, которые сервер считает видео (`isVideoFile` и
// `extensionKind` парсера): mkv/webm, mp4/m4v/mov/3gp, avi, ts/m2ts/mts,
// mpg/mpeg/vob, wmv, ogv, flv и ещё несколько файловых контейнеров
const VIDEO_FORMATS = [
  'matroska',
  'mov',
  'avi',
  'mpegts',
  'mpeg',
  'mpegvideo',
  'asf',
  'flv',
  'ogg',
  'rm',
  'wtv',
  'mxf',
].join(',')

/**
 * Входные опции ffmpeg и ffprobe для файла раздачи или библиотеки. Демуксер
 * выбирается по содержимому: без списков файл с манифестом DASH или HLS
 * заставил бы сервер ходить по ссылкам из него, в том числе в локальную сеть.
 * Поток движка читается только по HTTP, файл библиотеки — только с диска.
 */
function addonInputFormat(input: string) {
  const path
    = /^http:\/\/127\.0\.0\.1:\d+\/addon-media\/[\da-f-]+\.(mp4|mkv)$/u.exec(
      input,
    )
  return path?.[1]
}

export function mediaInputEnv(input: string) {
  if (!addonInputFormat(input))
    return undefined
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/_proxy$|^ffreport$/i.test(key),
    ),
  )
}

export function untrustedInputArgs(input: string) {
  const addon = addonInputFormat(input)
  if (addon) {
    return [
      '-protocol_whitelist',
      'http,tcp',
      '-format_whitelist',
      addon === 'mp4' ? 'mov' : 'matroska',
      ...(addon === 'mp4'
        ? ['-enable_drefs', '0', '-use_absolute_path', '0']
        : []),
    ]
  }

  const protocols = /^http:\/\//i.test(input) ? 'http,tcp' : 'file'

  return ['-protocol_whitelist', protocols, '-format_whitelist', VIDEO_FORMATS]
}
