import type { Torrent } from '../../db/schema.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'

function comparePaths(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true })
}

/**
 * Порядок закачки выбора: серии по сезону и номеру, остальное — после них по
 * пути. Движок качает первым первый недокачанный файл этого порядка: при
 * одном приоритете серии сезона докачивались бы почти одновременно
 */
export function downloadOrder(
  torrent: Pick<Torrent, 'name' | 'files'>,
  selected: number[],
) {
  const files = torrent.files ?? []
  const entries = files
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const matches = matchFiles(
    entries.map(({ path, size }) => ({ path, size })),
    parseRelease(torrent.name),
  )
  const numbers = new Map(
    entries.map((entry, i) => {
      const match = matches[i]
      const episode = match?.episode ?? match?.absolute

      return [
        entry.index,
        episode === undefined
          ? undefined
          : { season: match?.season ?? 0, episode },
      ] as const
    }),
  )

  return [...new Set(selected)].sort((a, b) => {
    const x = numbers.get(a)
    const y = numbers.get(b)

    if (x && y && (x.season !== y.season || x.episode !== y.episode))
      return x.season - y.season || x.episode - y.episode
    if (x && !y)
      return -1
    if (!x && y)
      return 1

    return comparePaths(files[a]?.path ?? '', files[b]?.path ?? '')
  })
}
