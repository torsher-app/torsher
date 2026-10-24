/**
 * Работа с файлами SQLite в отдельном потоке: better-sqlite3 синхронный, и
 * `VACUUM INTO` или `integrity_check` большой базы на главном потоке
 * заморозили бы поток видео и API.
 *
 * Поток исполняется самим Node, а не сборкой тестов, поэтому импортирует
 * только better-sqlite3 и `node:*`: модули сервера (config и прочие) тянут
 * за собой окружение и базу главного потока. Всё нужное приходит в
 * `workerData`.
 */
import { chmodSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'

/** Снимок базы: копия, очистка данных TMDB, манифест, проверка */
export interface SnapshotJob {
  mode: 'snapshot'
  sourcePath: string
  targetPath: string
  /** Виды алиасов, собранных из TMDB: их нельзя хранить дольше срока TMDB */
  tmdbAliasKinds: string[]
  manifestTable: string
  manifest: Record<string, string>
}

/** Что известно о файле копии: решение принимает главный поток */
export interface InspectJob {
  mode: 'inspect'
  path: string
  manifestTable: string
}

export interface SnapshotFacts {
  integrity: string
  hasMigrations: boolean
  hasUsers: boolean
  users: number
  lastApplied: number | null
  manifest?: Record<string, string>
}

export type WorkerJob = SnapshotJob | InspectJob

export type WorkerResult
  = | { ok: true, facts?: SnapshotFacts }
    | {
      ok: false
      kind: 'integrity' | 'io' | 'not_sqlite' | 'corrupt'
      code?: string
      message: string
    }

function hasTable(db: Database.Database, name: string) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name),
  )
}

function snapshot(job: SnapshotJob): WorkerResult {
  const source = new Database(job.sourcePath, {
    readonly: true,
    fileMustExist: true,
  })

  try {
    source.prepare('VACUUM INTO ?').run(job.targetPath)
  }
  finally {
    source.close()
  }

  // В снимке история и ключ секретов: файл только для владельца. Каталог
  // снимков и так 0700, а ФС без прав POSIX отвечает EPERM — это не сбой
  try {
    chmodSync(job.targetPath, 0o600)
  }
  catch {}

  const db = new Database(job.targetPath)

  try {
    db.pragma('journal_mode = DELETE')
    // Удалённые страницы обнуляются: в сжатой копии их почти не видно, и
    // второй VACUUM (ещё одна полная копия на диске) не нужен
    db.pragma('secure_delete = ON')

    // Данные TMDB живут не дольше полугода, а ручная копия — сколько угодно.
    // В снимке старой версии таблиц может ещё не быть
    db.transaction(() => {
      if (hasTable(db, 'meta_cache'))
        db.exec('DELETE FROM meta_cache')

      if (hasTable(db, 'title_external_ids'))
        db.exec('DELETE FROM title_external_ids')

      if (hasTable(db, 'title_aliases') && job.tmdbAliasKinds.length) {
        db.prepare(
          `DELETE FROM title_aliases WHERE kind IN (${job.tmdbAliasKinds.map(() => '?').join(', ')})`,
        ).run(...job.tmdbAliasKinds)
      }

      db.exec(
        `CREATE TABLE "${job.manifestTable}" (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      )

      const insert = db.prepare(
        `INSERT INTO "${job.manifestTable}" (key, value) VALUES (?, ?)`,
      )

      for (const [key, value] of Object.entries(job.manifest))
        insert.run(key, value)
    })()

    const check = db.pragma('integrity_check', { simple: true })

    if (check !== 'ok')
      return { ok: false, kind: 'integrity', message: String(check) }
  }
  finally {
    db.close()
  }

  return { ok: true }
}

function inspect(job: InspectJob): WorkerResult {
  let db: Database.Database

  try {
    db = new Database(job.path, { readonly: true, fileMustExist: true })
  }
  catch (err) {
    return { ok: false, kind: 'not_sqlite', message: String(err) }
  }

  try {
    const integrity = String(db.pragma('integrity_check', { simple: true }))

    if (integrity !== 'ok') {
      return {
        ok: true,
        facts: {
          integrity,
          hasMigrations: false,
          hasUsers: false,
          users: 0,
          lastApplied: null,
        },
      }
    }

    const hasMigrations = hasTable(db, '__drizzle_migrations')
    const hasUsers = hasTable(db, 'users')
    const users = hasUsers
      ? (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n
      : 0
    const last = hasMigrations
      ? (
          db
            .prepare('SELECT max(created_at) AS last FROM __drizzle_migrations')
            .get() as { last: number | string | null }
        ).last
      : null
    const manifest = hasTable(db, job.manifestTable)
      ? Object.fromEntries(
          (
            db
              .prepare(`SELECT key, value FROM "${job.manifestTable}"`)
              .all() as { key: string, value: string }[]
          ).map(row => [row.key, row.value]),
        )
      : undefined

    return {
      ok: true,
      facts: {
        integrity,
        hasMigrations,
        hasUsers,
        users,
        lastApplied: last === null ? null : Number(last),
        manifest,
      },
    }
  }
  finally {
    db.close()
  }
}

function failure(err: unknown): WorkerResult {
  const code
    = typeof err === 'object' && err !== null && 'code' in err
      ? String(err.code)
      : undefined

  // Повреждённый файл SQLite при проверке — не ошибка ввода-вывода
  if (code === 'SQLITE_CORRUPT')
    return { ok: false, kind: 'corrupt', code, message: String(err) }

  if (code === 'SQLITE_NOTADB')
    return { ok: false, kind: 'not_sqlite', code, message: String(err) }

  return {
    ok: false,
    kind: 'io',
    ...(code ? { code } : {}),
    message: err instanceof Error ? err.message : String(err),
  }
}

let result: WorkerResult
const job = workerData as WorkerJob

try {
  result = job.mode === 'snapshot' ? snapshot(job) : inspect(job)
}
catch (err) {
  result = failure(err)
}

parentPort?.postMessage(result)
