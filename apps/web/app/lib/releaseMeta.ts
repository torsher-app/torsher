import type { Torrent } from '@torsher/api-client'
import { matchFiles, parseRelease } from '@torsher/release-parser'

export interface ReleaseMeta {
  /** Разрешение из имени раздачи: `1080p` */
  quality?: string
  /** Сезоны и серии раздачи: `S02E05`, `S01E01–E10`, `S01–S03` */
  episodes?: string
  /** Серия каждого файла по его индексу */
  fileEpisodes: Map<number, string>
}

const pad = (value: number) => String(value).padStart(2, '0')

function episodeLabel(season: number | undefined, from: number, to?: number) {
  const prefix = season === undefined ? '' : `S${pad(season)}`
  const range = to && to !== from ? `–E${pad(to)}` : ''

  return `${prefix}E${pad(from)}${range}`
}

function seasonsLabel(seasons: number[]) {
  if (seasons.length === 0)
    return undefined

  const first = Math.min(...seasons)
  const last = Math.max(...seasons)

  return first === last ? `S${pad(first)}` : `S${pad(first)}–S${pad(last)}`
}

/**
 * Сезон, серии и качество из имени раздачи и её файлов — для меты строки и
 * подписи файла. Связь с тайтлом каталога даёт сервер (`titleId`), это —
 * только чтение имён.
 */
export function releaseMetaOf(
  torrent: Pick<Torrent, 'name' | 'files'>,
): ReleaseMeta {
  const parsed = parseRelease(torrent.name)
  const matches = matchFiles(
    torrent.files.map(file => ({ path: file.path, size: file.size })),
    parsed,
  )
  const fileEpisodes = new Map<number, string>()

  matches.forEach((match, position) => {
    const file = torrent.files[position]

    if (file && match.kind === 'video' && match.episode !== undefined) {
      fileEpisodes.set(
        file.index,
        episodeLabel(match.season, match.episode, match.episodeTo),
      )
    }
  })

  const season = parsed.seasons.length === 1 ? parsed.seasons[0] : undefined
  const episodes = parsed.episodes
    ? episodeLabel(season, parsed.episodes.from, parsed.episodes.to)
    : seasonsLabel(parsed.seasons)

  return { quality: parsed.quality, episodes, fileEpisodes }
}
