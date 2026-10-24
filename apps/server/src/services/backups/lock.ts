import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { BackupError } from './errors.ts'

// Замок дольше часа — процесс умер, не сняв его (или живёт в другом контейнере)
const STALE_MS = 60 * 60 * 1000

let backupRunning = false
// Замки этого процесса: свой PID в файле иначе считался бы протухшим
const held = new Set<string>()

function isAlive(pid: number) {
  if (pid === process.pid)
    return false

  try {
    process.kill(pid, 0)

    return true
  }
  catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isStale(path: string, now: number) {
  try {
    const { pid, at } = JSON.parse(readFileSync(path, 'utf8')) as {
      pid: number
      at: number
    }

    return !isAlive(pid) || now - at > STALE_MS
  }
  catch {
    // Пустой или битый файл: процесс упал между созданием и записью
    return true
  }
}

function tryCreate(path: string, now: number) {
  const fd = openSync(path, 'wx', 0o600)

  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, at: now }))
  }
  finally {
    closeSync(fd)
  }
}

/**
 * Файл-замок с PID и временем: между процессами (команда в контейнере при
 * работающем сервере). Протухший замок снимается. Занято — `busy`.
 */
export function acquireFileLock(path: string, now = Date.now()) {
  if (held.has(path))
    throw new BackupError('busy')

  try {
    tryCreate(path, now)
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
      throw err

    if (!isStale(path, now))
      throw new BackupError('busy')

    rmSync(path, { force: true })

    try {
      tryCreate(path, now)
    }
    catch (retryErr) {
      if ((retryErr as NodeJS.ErrnoException).code === 'EEXIST')
        throw new BackupError('busy')

      throw retryErr
    }
  }

  held.add(path)

  return () => {
    held.delete(path)
    rmSync(path, { force: true })
  }
}

/**
 * Одна копия за раз: флаг в процессе и замок `.lock` в каталоге копий.
 * Возвращает снятие замка.
 */
export function acquireBackupLock(dir: string, now = Date.now()) {
  if (backupRunning)
    throw new BackupError('busy')

  const release = acquireFileLock(join(dir, '.lock'), now)

  backupRunning = true

  return () => {
    backupRunning = false
    release()
  }
}
