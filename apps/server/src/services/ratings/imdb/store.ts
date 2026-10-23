import type { Statement } from 'better-sqlite3'
import { existsSync, rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { config } from '../../../config.ts'

export interface ImdbRating {
  value: number
  votes: number
}

const IMDB_ID = /^tt(\d{1,10})$/

/** Числовая часть `tt0133093`: ключ таблицы оценок */
export function imdbNumber(imdbId: string) {
  const match = IMDB_ID.exec(imdbId)

  return match ? Number(match[1]) : undefined
}

export function imdbStorePath() {
  return config.imdbRatingsPath
}

let reader:
  | {
    db: Database.Database
    select: Statement<
      [string],
      { id: number, rating: number, votes: number }
    >
  }
  | undefined

function openReader() {
  const path = imdbStorePath()

  if (!existsSync(path))
    return undefined

  const db = new Database(path, { readonly: true, fileMustExist: true })
  const select = db.prepare<
    [string],
    { id: number, rating: number, votes: number }
  >(
    'SELECT id, rating, votes FROM ratings WHERE id IN (SELECT value FROM json_each(?))',
  )

  return { db, select }
}

/**
 * Оценки пачкой по IMDb ID. Нет файла или он битый — пустой ответ: без
 * выгрузки у тайтла просто нет оценки IMDb.
 */
export function lookupImdbRatings(imdbIds: string[]) {
  const found = new Map<string, ImdbRating>()
  const byNumber = new Map<number, string>()

  for (const id of imdbIds) {
    const number = imdbNumber(id)

    if (number !== undefined)
      byNumber.set(number, id)
  }

  if (byNumber.size === 0)
    return found

  try {
    reader ??= openReader()

    if (!reader)
      return found

    for (const row of reader.select.all(JSON.stringify([...byNumber.keys()]))) {
      const id = byNumber.get(row.id)

      if (id)
        found.set(id, { value: row.rating / 10, votes: row.votes })
    }
  }
  catch {
    closeImdbStore()
  }

  return found
}

/** Перед заменой и удалением файла: следующий поиск откроет его заново */
export function closeImdbStore() {
  reader?.db.close()
  reader = undefined
}

export function removeImdbStore() {
  closeImdbStore()
  rmSync(imdbStorePath(), { force: true })
}
