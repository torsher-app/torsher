import type Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type SchemaComparison = 'same' | 'behind' | 'ahead'

interface JournalFile {
  entries: { idx: number, when: number, tag: string }[]
}

/** Время миграций из журнала сборки: Drizzle сравнивает с ним `created_at` в базе */
export function readJournal(folder: string) {
  const journal = JSON.parse(
    readFileSync(join(folder, 'meta/_journal.json'), 'utf8'),
  ) as JournalFile
  const whens = journal.entries.map(entry => entry.when)

  return { whens, lastWhen: whens.length ? Math.max(...whens) : 0 }
}

/** Последняя применённая миграция; нет таблицы или записей — база пустая (`null`) */
export function lastAppliedAt(db: Database.Database): number | null {
  const table = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`,
    )
    .get()

  if (!table)
    return null

  const row = db
    .prepare('SELECT max(created_at) AS last FROM __drizzle_migrations')
    .get() as { last: number | string | null }

  return row.last === null ? null : Number(row.last)
}

export function compareSchema(
  lastApplied: number | null,
  lastWhen: number,
): SchemaComparison {
  if (lastApplied === null || lastApplied < lastWhen)
    return 'behind'

  return lastApplied > lastWhen ? 'ahead' : 'same'
}

/**
 * Версия Torsher, которая последней работала с базой: её данные и попадут в
 * копию. Копию перед обновлением снимает уже новая версия, а откатываться
 * нужно на эту. Истории версий нет — пустая версия.
 */
export function dataVersionOf(db: Database.Database): {
  version: string
  commit?: string
} {
  const table = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'server_versions'`,
    )
    .get()

  if (!table)
    return { version: '' }

  const row = db
    .prepare(
      'SELECT version, "commit" FROM server_versions ORDER BY id DESC LIMIT 1',
    )
    .get() as { version: string, commit: string | null } | undefined

  return { version: row?.version ?? '', commit: row?.commit ?? undefined }
}
