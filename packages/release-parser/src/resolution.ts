import type {
  ParsedRelease,
  Resolution,
  Source,
  VideoClass,
  VideoResolution,
} from './types.ts'

/**
 * Разрешение по размеру кадра: ширина или высота, чтобы кроп 2.40:1
 * (`1920x800`) и 4:3 (`1440x1080`) попадали в свой класс.
 */
export function frameResolution(width: number, height: number): Resolution {
  if (width >= 3200 || height >= 2100)
    return '2160p'
  if (width >= 2400 || height >= 1400)
    return '1440p'
  if (width >= 1800 || height >= 1000)
    return '1080p'
  if (width >= 1200 || height >= 700)
    return '720p'
  if (width >= 1000 || height >= 560)
    return '576p'
  return '480p'
}

const CLASSES: Record<Resolution, VideoClass> = {
  '2160p': '2160p',
  '1440p': '1080p',
  '1080p': '1080p',
  '1080i': '1080p',
  '720p': '720p',
  '576p': 'SD',
  '480p': 'SD',
  '360p': 'SD',
}

export function videoClassOf(resolution: Resolution): VideoClass {
  return CLASSES[resolution]
}

// Рип без числа на русских трекерах — SD около 720×400: HD-рипы подписывают
// разрешением. Диск и его ремукс меньше 1080p не бывают. WEB-DL, HDTV и IPTV
// без числа бывают любыми — для них вывода нет
const SOURCE_CLASSES: Partial<Record<Source, VideoClass>> = {
  'BDRip': 'SD',
  'HDRip': 'SD',
  'WEB-DLRip': 'SD',
  'WEBRip': 'SD',
  'HDTVRip': 'SD',
  'SATRip': 'SD',
  'TVRip': 'SD',
  'DVB': 'SD',
  'CAMRip': 'SD',
  'TS': 'SD',
  'Blu-ray': '1080p',
  'BDRemux': '1080p',
}

/**
 * Разрешение раздачи по названию: явное число или кадр — точно; DVD — точно
 * SD; иначе вывод по типу рипа или кодеку эпохи SD. `undefined` — вывести
 * нельзя.
 */
export function videoResolution(
  parsed: Pick<ParsedRelease, 'quality' | 'source' | 'codec'>,
): VideoResolution | undefined {
  if (parsed.quality)
    return { value: videoClassOf(parsed.quality), basis: 'title', sure: true }

  if (parsed.source === 'DVD' || parsed.source === 'DVDRip')
    return { value: 'SD', basis: 'source', sure: true }

  if (parsed.codec === 'XviD' || parsed.codec === 'DivX')
    return { value: 'SD', basis: 'codec', sure: false }

  const value = parsed.source && SOURCE_CLASSES[parsed.source]

  return value ? { value, basis: 'source', sure: false } : undefined
}
