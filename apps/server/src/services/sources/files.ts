import type { Torrent } from '../../db/schema.ts'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'
import { isVideoFile } from '../torrents/index.ts'
import { isProgressWatched } from './progress.ts'

/** Видеофайл раздачи для экрана «Файлы»: серия по имени и её прогресс */
export interface TitleFile {
  fileIndex: number
  /** Имя файла без папок и расширения */
  name: string
  size: number
  season?: number
  episode?: number
  position: number
  duration: number | null
  watched: boolean
}

function baseName(path: string) {
  const file = path.split('/').pop() ?? path

  return file.includes('.') ? file.slice(0, file.lastIndexOf('.')) : file
}

/**
 * Видео раздачи в естественном порядке («2» раньше «10»). У сериала серия — по
 * `matchFiles`, сезон без номера в файле — сезон раздачи; прогресс — из
 * `title_progress` профиля по серии, у фильма — по тайтлу.
 */
export function titleFiles(
  torrent: Torrent,
  ref: { profileId: string, titleId: string, kind: 'movie' | 'series' },
): TitleFile[] {
  const entries = (torrent.files ?? [])
    .map((file, index) => ({ ...file, index }))
    .filter(file => !file.padding)
  const parsed = parseRelease(torrent.name)
  // `kind` отделяет серии от сэмплов и допов; номер серии нужен только сериалу
  const matches = matchFiles(
    entries.map(({ path, size }) => ({ path, size })),
    parsed,
  )
  const rows = getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, ref.profileId),
        eq(titleProgress.titleId, ref.titleId),
      ),
    )
    .all()
  const progress = new Map(
    rows.map(row => [`${row.season}:${row.episode}`, row]),
  )

  return entries
    .map((file, i) => {
      const match = matches[i]
      const episode
        = ref.kind === 'series' && match?.kind === 'video'
          ? match.episode
          : undefined
      const season
        = episode === undefined
          ? undefined
          : (match?.season
            ?? (parsed.seasons.length === 1 ? parsed.seasons[0] : undefined))
      const row = progress.get(
        ref.kind === 'movie' ? '0:0' : `${season ?? 0}:${episode ?? 0}`,
      )
      const known = ref.kind === 'movie' || episode !== undefined

      return {
        file,
        item: {
          fileIndex: file.index,
          name: baseName(file.path),
          size: file.size,
          season,
          episode,
          position: known ? (row?.position ?? 0) : 0,
          duration: known ? (row?.duration ?? null) : null,
          watched: known && !!row && isProgressWatched(row),
        },
      }
    })
    .filter(({ file }, i) =>
      matches[i] ? matches[i]!.kind === 'video' : isVideoFile(file.path),
    )
    .sort((a, b) =>
      a.file.path.localeCompare(b.file.path, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    )
    .map(({ item }) => item)
}
