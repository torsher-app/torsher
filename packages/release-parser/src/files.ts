import type {
  FileKind,
  FileMatch,
  ParsedRelease,
  ReleaseFile,
} from './types.ts'
import { parseRelease } from './parse.ts'
import { isYearLike } from './rules/numbers.ts'

const EXTENSIONS: Record<string, FileKind> = {}
for (const ext of [
  'mkv',
  'mp4',
  'avi',
  'm4v',
  'ts',
  'm2ts',
  'mts',
  'mov',
  'wmv',
  'webm',
  'mpg',
  'mpeg',
  'vob',
  'flv',
])
  EXTENSIONS[ext] = 'video'
for (const ext of ['srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'sup'])
  EXTENSIONS[ext] = 'subtitle'
for (const ext of [
  'mka',
  'ac3',
  'eac3',
  'dts',
  'aac',
  'flac',
  'mp3',
  'wav',
  'ogg',
  'opus',
  'm4a',
])
  EXTENSIONS[ext] = 'audio'
for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])
  EXTENSIONS[ext] = 'image'

const SAMPLE = /(?:^|[\s.\-_[(])(?:sample|семпл|сэмпл)(?:$|[\s.\-_\])])/i
const EXTRA_DIRS
  = /^(?:extras?|featurettes?|bonus(?:es)?|бонусы|доп\.?\s*материалы|дополнительные\s*материалы|trailers?|трейлеры|behind\s*the\s*scenes|deleted\s*scenes)$/i
const EXTRA_NAME = /trailer|трейлер|featurette/i
const LEADING_NUMBER = /^[#№]?(\d{1,4})(?=$|[\s.\-_)\]])/
// Число отдельным словом, но не часть `5.1` или `2.0`
const LONE_NUMBER
  = /(?:^|[\s\-_[(]|(?<!\d)\.)(\d{1,3})(?=$|[\s\-_\])]|\.(?!\d))/g

// Маленькое видео рядом с большими — сэмпл, даже если так не названо
const SAMPLE_SHARE = 0.05
const SAMPLE_MAX_SIZE = 200 * 1024 * 1024

interface Numbering {
  season?: number
  episode?: number
  episodeTo?: number
  absolute?: number
  confidence: number
}

function splitPath(path: string) {
  const parts = path.split(/[/\\]/).filter(Boolean)
  const file = parts.pop() ?? ''
  const dot = file.lastIndexOf('.')
  return {
    dirs: parts,
    name: dot > 0 ? file.slice(0, dot) : file,
    ext: dot > 0 ? file.slice(dot + 1).toLowerCase() : '',
  }
}

/** Сезон из ближайшей папки: `Season 1`, `Сезон 01`, `S01`, `1 сезон`. */
function seasonFromDirs(dirs: string[]) {
  for (const dir of [...dirs].reverse()) {
    const { seasons, episodes } = parseRelease(dir)
    if (seasons.length === 1 && !episodes)
      return seasons[0]
  }
  return undefined
}

/** Номер без маркеров: `05. Пилот`, `05 - Название`, `Название 05`. */
function bareNumber(
  name: string,
): { value: number, confidence: number } | undefined {
  const leading = LEADING_NUMBER.exec(name)
  if (leading && !(leading[1]!.length === 4 && isYearLike(Number(leading[1]))))
    return { value: Number(leading[1]), confidence: 0.7 }

  const lone = [...name.matchAll(LONE_NUMBER)].map(match => Number(match[1]))
  if (lone.length === 1)
    return { value: lone[0]!, confidence: 0.5 }
  return undefined
}

function numbering(
  name: string,
  dirs: string[],
  release?: ParsedRelease,
): Numbering | undefined {
  const parsed = parseRelease(name)
  const releaseSeason
    = release?.seasons.length === 1 ? release.seasons[0] : undefined
  const season
    = parsed.seasons.length === 1
      ? parsed.seasons[0]
      : (seasonFromDirs(dirs) ?? releaseSeason)

  if (parsed.episodes) {
    const { from, to } = parsed.episodes
    return {
      season,
      episode: from,
      episodeTo: to > from ? to : undefined,
      confidence: parsed.confidence.episodes ?? 0.8,
    }
  }

  if (parsed.absolute) {
    if (season !== undefined && !release?.absolute)
      return { season, episode: parsed.absolute.from, confidence: 0.7 }
    return { absolute: parsed.absolute.from, confidence: 0.7 }
  }

  const bare = release?.kind === 'movie' ? undefined : bareNumber(name)
  if (!bare)
    return undefined

  if (season !== undefined) {
    // 105 в первом сезоне — S01E05
    const episode
      = bare.value >= 100 && Math.floor(bare.value / 100) === season
        ? bare.value % 100
        : bare.value
    return { season, episode, confidence: bare.confidence }
  }
  if (release?.absolute)
    return { absolute: bare.value, confidence: bare.confidence }
  return { episode: bare.value, confidence: bare.confidence }
}

/** Вид файла только по расширению: видео, субтитры, дорожка, картинка или прочее */
export function extensionKind(path: string): FileKind {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')

  return (dot > 0 && EXTENSIONS[name.slice(dot + 1).toLowerCase()]) || 'other'
}

function kindOf(
  file: ReleaseFile,
  dirs: string[],
  name: string,
  ext: string,
  largestVideo: number,
): FileKind {
  const kind = EXTENSIONS[ext] ?? 'other'
  if (kind !== 'video')
    return kind
  if (dirs.some(dir => EXTRA_DIRS.test(dir.trim())) || EXTRA_NAME.test(name))
    return 'extra'
  if (SAMPLE.test(name) || dirs.some(dir => /^samples?$/i.test(dir)))
    return 'sample'
  if (file.size < SAMPLE_MAX_SIZE && file.size < largestVideo * SAMPLE_SHARE)
    return 'sample'
  return 'video'
}

/**
 * Сопоставляет файлы раздачи с сериями: `s13e05`, `13x05`, `05 серия`, абсолютная
 * нумерация, сезон из папки. Сэмплы, доп. материалы, субтитры и обложки помечены
 * своим `kind`; номер серии ищется у видео, внешних субтитров и дорожек.
 */
export function matchFiles(
  files: ReleaseFile[],
  parsed?: ParsedRelease,
): FileMatch[] {
  const split = files.map(file => splitPath(file.path))
  const largestVideo = Math.max(
    0,
    ...files
      .filter((_, i) => EXTENSIONS[split[i]!.ext] === 'video')
      .map(file => file.size),
  )

  const matches: FileMatch[] = files.map((file, i) => {
    const { dirs, name, ext } = split[i]!
    const kind = kindOf(file, dirs, name, ext, largestVideo)
    const match: FileMatch = { path: file.path, size: file.size, kind }
    if (kind !== 'video' && kind !== 'subtitle' && kind !== 'audio')
      return match

    const found = numbering(name, dirs, parsed)
    if (found) {
      for (const [key, value] of Object.entries(found)) {
        if (value !== undefined)
          Object.assign(match, { [key]: value })
      }
    }
    return match
  })

  assignByOrder(matches, parsed)
  return matches
}

/**
 * Видео без номеров, когда их столько же, сколько серий в раздаче: нумеруем
 * по естественному порядку имён. Уверенность низкая.
 */
function assignByOrder(matches: FileMatch[], parsed?: ParsedRelease) {
  const videos = matches.filter(match => match.kind === 'video')
  const range = parsed?.episodes
  if (
    !range
    || videos.length < 2
    || videos.some(
      match => match.episode !== undefined || match.absolute !== undefined,
    )
  ) {
    return
  }
  if (videos.length !== range.to - range.from + 1)
    return

  const season = parsed.seasons.length === 1 ? parsed.seasons[0] : undefined
  const sorted = [...videos].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true }),
  )
  sorted.forEach((match, i) => {
    if (season !== undefined)
      match.season = season
    match.episode = range.from + i
    match.confidence = 0.4
  })
}
