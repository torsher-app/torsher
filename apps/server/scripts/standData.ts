/**
 * Данные стенда ветки (`pnpm dev:stand`): копия dev-данных разработчика и её
 * обезвреживание. Исходная база открывается только на чтение.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { constants, cp, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'

/** Каталог стенда: один на checkout, у разных worktree — разные */
export function standDirFor(root: string, checkout: string) {
  const hash = createHash('sha256').update(resolve(checkout)).digest('hex')

  return join(root, `${basename(checkout)}-${hash.slice(0, 8)}`)
}

function isInside(base: string, path: string) {
  const rel = relative(base, path)

  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep))
}

/** Путь внутри одного из исходных каталогов — на тот же путь в стенде */
export function mapPath(path: string, moves: [from: string, to: string][]) {
  for (const [from, to] of moves) {
    if (isInside(from, path))
      return join(to, relative(from, path))
  }

  return undefined
}

export interface SourceData {
  dataDir: string
  databasePath: string
  downloadsPath: string
  libraryPath: string
}

export interface StandData {
  dataDir: string
  databasePath: string
  downloadsPath: string
  libraryPath: string
}

/** Согласованный снимок базы с содержимым WAL, даже пока в неё пишет dev */
export async function snapshotDb(source: string, target: string) {
  const db = new Database(source, { readonly: true, fileMustExist: true })

  try {
    await db.backup(target)
  }
  finally {
    db.close()
  }
}

/** Копия без лишнего места: на APFS, Btrfs и XFS — клон, иначе — байты */
export async function cloneDir(source: string, target: string) {
  if (!existsSync(source))
    return

  await cp(source, target, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    preserveTimestamps: true,
  })
}

export async function dirSize(path: string): Promise<number> {
  const info = await stat(path).catch(() => undefined)

  if (!info)
    return 0

  if (!info.isDirectory())
    return info.size

  let total = 0

  for (const name of await readdir(path))
    total += await dirSize(join(path, name))

  return total
}

/**
 * Копирует то, без чего сервер не поднимется с данными разработчика. Сессия
 * движка — только вместе с файлами: без них движок скачал бы раздачи заново.
 */
export async function copyData(
  source: SourceData,
  stand: StandData,
  withFiles: boolean,
) {
  await mkdir(stand.dataDir, { recursive: true })
  await snapshotDb(source.databasePath, stand.databasePath)

  for (const name of ['secret.key', 'thumbs', 'imdb-ratings.db'])
    await cloneDir(join(source.dataDir, name), join(stand.dataDir, name))

  if (withFiles) {
    await cloneDir(source.downloadsPath, stand.downloadsPath)
    await cloneDir(source.libraryPath, stand.libraryPath)
    await cloneDir(
      join(source.dataDir, 'engine', 'state'),
      join(stand.dataDir, 'engine', 'state'),
    )
  }
}

function hasTable(db: Database.Database, name: string) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name),
  )
}

function readSetting(db: Database.Database, key: string) {
  const row = db
    .prepare('SELECT value FROM server_settings WHERE key = ?')
    .get(key) as { value: string } | undefined

  return row && (JSON.parse(row.value) as Record<string, unknown>)
}

/** Свой путь хранилища из панели: им пользуется сервер разработчика */
export function savedStoragePath(
  databasePath: string,
  kind: 'downloads' | 'library',
) {
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  })

  try {
    if (!hasTable(db, 'server_settings'))
      return undefined

    const value = readSetting(db, 'storage.paths')?.[kind]

    return typeof value === 'string' ? value : undefined
  }
  finally {
    db.close()
  }
}

export interface OwnerInfo {
  email: string
  passwordHash: string
}

export function readOwner(databasePath: string): OwnerInfo | undefined {
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  })

  try {
    if (!hasTable(db, 'users'))
      return undefined

    return db
      .prepare(
        'SELECT email, password_hash AS passwordHash FROM users ORDER BY rowid LIMIT 1',
      )
      .get() as OwnerInfo | undefined
  }
  finally {
    db.close()
  }
}

/**
 * Копия не должна трогать мир разработчика: писать в его каталоги, переносить
 * его файлы, класть копии к его бэкапам и слать сообщения в его каналы.
 * Новая настройка с путём или внешним действием дописывается сюда.
 */
export function sanitizeDb(
  databasePath: string,
  source: SourceData,
  stand: StandData,
  ownerEmail: string,
) {
  const db = new Database(databasePath, { fileMustExist: true })
  const moves: [string, string][] = [
    [resolve(source.libraryPath), stand.libraryPath],
    [resolve(source.downloadsPath), stand.downloadsPath],
    [resolve(source.dataDir), stand.dataDir],
  ]

  try {
    db.transaction(() => {
      if (hasTable(db, 'users')) {
        db.prepare(
          'UPDATE users SET email = ? WHERE rowid = (SELECT rowid FROM users ORDER BY rowid LIMIT 1)',
        ).run(ownerEmail)
      }

      // Раздачи — в загрузки стенда: свои каталоги разработчика движок не тронет
      if (hasTable(db, 'torrents'))
        db.prepare('UPDATE torrents SET download_dir = NULL').run()

      if (hasTable(db, 'storage_moves'))
        db.prepare('DELETE FROM storage_moves').run()

      if (hasTable(db, 'notification_channels'))
        db.prepare('UPDATE notification_channels SET enabled = 0').run()

      // Папки, выбранные в панели вне каталогов данных, сервер только читает
      if (hasTable(db, 'library_folders')) {
        const folders = db
          .prepare('SELECT id, path FROM library_folders')
          .all() as { id: string, path: string }[]
        const update = db.prepare(
          'UPDATE library_folders SET path = ? WHERE id = ?',
        )

        for (const folder of folders) {
          const path = mapPath(resolve(folder.path), moves)

          if (path)
            update.run(path, folder.id)
        }
      }

      if (hasTable(db, 'server_settings')) {
        db.prepare(
          `DELETE FROM server_settings WHERE key = 'storage.paths'`,
        ).run()

        // Порт пиров разработчика занят его движком, а UPnP открыл бы порт на
        // роутере: стенд выбирает свой порт и роутер не трогает
        db.prepare(
          `DELETE FROM server_settings WHERE key = 'torrent.generatedPeerPort'`,
        ).run()

        const torrent = readSetting(db, 'torrent')

        if (torrent) {
          delete torrent.peerPort
          delete torrent.upnp
          db.prepare(
            `UPDATE server_settings SET value = ? WHERE key = 'torrent'`,
          ).run(JSON.stringify(torrent))
        }

        const backups = readSetting(db, 'backups')

        if (backups) {
          delete backups.dir
          db.prepare(
            `UPDATE server_settings SET value = ? WHERE key = 'backups'`,
          ).run(JSON.stringify({ ...backups, enabled: false }))
        }
        else {
          db.prepare(
            `INSERT INTO server_settings (key, value, updated_at) VALUES ('backups', ?, ?)`,
          ).run(JSON.stringify({ enabled: false }), Date.now())
        }
      }
    })()
  }
  finally {
    db.close()
  }
}
