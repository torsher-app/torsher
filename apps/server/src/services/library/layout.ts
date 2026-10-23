import { Buffer } from 'node:buffer'

// Имя папки и файла — до 120 байт: запас под ` (2010) [tmdbid-…]`, номер
// серии и расширение в пределах 255 байт имени у ext4 и btrfs
const MAX_NAME_BYTES = 120

export interface LayoutTitle {
  kind: 'movie' | 'series'
  name: string
  year?: number
  tmdbId: number
}

export interface LayoutEpisode {
  season: number
  episode: number
  /** Последняя серия файла с несколькими сериями */
  episodeTo?: number
}

function truncateBytes(value: string, max: number) {
  if (Buffer.byteLength(value) <= max)
    return value

  let result = ''

  // По символам, а не по байтам: суррогатная пара не разрезается
  for (const char of value) {
    if (Buffer.byteLength(result + char) > max)
      break

    result += char
  }

  return result
}

/**
 * Имя без символов, запрещённых в Windows и SMB (`/\:*?"<>|`), управляющих
 * символов и завершающих точек и пробелов; не длиннее 120 байт.
 */
export function safeName(value: string) {
  const cleaned = value
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return truncateBytes(cleaned, MAX_NAME_BYTES).replace(/[.\s]+$/, '')
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

/** `Название (2010) [tmdbid-27205]`: сопоставление держится на ID, а не на названии */
export function titleFolder(title: LayoutTitle) {
  const name = safeName(title.name) || 'Untitled'
  const year = title.year ? ` (${title.year})` : ''

  return `${name}${year} [tmdbid-${title.tmdbId}]`
}

export function episodeCode(episode: LayoutEpisode) {
  const last
    = episode.episodeTo !== undefined && episode.episodeTo > episode.episode
      ? `-E${pad(episode.episodeTo)}`
      : ''

  return `S${pad(episode.season)}E${pad(episode.episode)}${last}`
}

/**
 * Путь видеофайла от корня своей раскладки, как у Jellyfin:
 * `movies/Название (2010) [tmdbid-27205]/Название (2010) [tmdbid-27205].mkv`,
 * `shows/Название (2008) [tmdbid-1396]/Season 01/Название S01E05.mkv`.
 * Вторая версия того же фильма или серии — `… - 2160p.mkv`.
 */
/**
 * Видео раздачи без тайтла («не фильм и не сериал»): `other/<раздача>/<путь в
 * раздаче>`; у раздачи из одного файла папка — имя без расширения
 */
export function otherPath(releaseName: string, filePath: string) {
  const parts = filePath.split('/').map(safeName).filter(Boolean)
  const base
    = safeName(releaseName.replace(/\.[a-z0-9]{2,4}$/i, '')) || 'Video'
  const inner
    = parts.length > 1 && parts[0] === safeName(releaseName)
      ? parts.slice(1)
      : parts

  return ['other', base, ...inner].join('/')
}

export function videoPath(
  title: LayoutTitle,
  extension: string,
  episode?: LayoutEpisode,
  version?: string,
) {
  const folder = titleFolder(title)
  const suffix = version ? ` - ${safeName(version)}` : ''
  const ext = extension.toLowerCase()

  if (title.kind === 'movie' || !episode)
    return `movies/${folder}/${folder}${suffix}.${ext}`

  const name = safeName(title.name) || 'Untitled'

  return `shows/${folder}/Season ${pad(episode.season)}/${name} ${episodeCode(episode)}${suffix}.${ext}`
}

/** Внешние субтитры и дорожки — рядом с тем же базовым именем: `….rus.forced.srt` */
export function sidecarPath(video: string, extension: string, tags: string[]) {
  const base = video.slice(0, video.lastIndexOf('.'))
  const parts = tags.map(safeName).filter(Boolean)

  return [base, ...parts, extension.toLowerCase()].join('.')
}

export function extensionOf(path: string) {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')

  return dot > 0 ? name.slice(dot + 1) : ''
}
