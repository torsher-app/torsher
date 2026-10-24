import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIGRATIONS_DIR } from '../index.ts'

/**
 * Каталоги миграций для тестов: журнал, обрезанный до предыдущей версии
 * (база в том виде, в каком её застаёт обновление), или с лишней миграцией.
 */
export interface Journal {
  entries: { idx: number, when: number, tag: string }[]
}

export function readMigrationsJournal(): Journal {
  return JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
  ) as Journal
}

function copyMigrations(entries: Journal['entries']) {
  const dir = mkdtempSync(join(tmpdir(), 'torsher-migrations-'))
  const journal = readMigrationsJournal()

  cpSync(MIGRATIONS_DIR, dir, { recursive: true })
  writeFileSync(
    join(dir, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries }),
  )

  return dir
}

/** Первые `count` миграций */
export function migrationsBefore(count: number) {
  return copyMigrations(readMigrationsJournal().entries.slice(0, count))
}

/** Все миграции и ещё одна с данным SQL — «следующая версия» */
export function migrationsWithExtra(sql: string) {
  const { entries } = readMigrationsJournal()
  const last = entries.at(-1)!
  const tag = '9999_extra'
  const dir = copyMigrations([
    ...entries,
    { ...last, idx: last.idx + 1, when: last.when + 1000, tag },
  ])

  writeFileSync(join(dir, `${tag}.sql`), sql)

  return dir
}
