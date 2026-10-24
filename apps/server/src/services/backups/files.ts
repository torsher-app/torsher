import type { Buffer } from 'node:buffer'
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs'
import { chmod } from 'node:fs/promises'
import { dirname } from 'node:path'
import { logFor } from '../logs/index.ts'
import { decodeKeyFile } from '../secrets/index.ts'

/** Без fsync каталога rename может не пережить отключение питания */
export function syncDir(dir: string) {
  // Не на всех ФС каталог открывается на чтение — тогда без него
  try {
    fsyncFile(dir)
  }
  catch {}
}

export function fsyncFile(path: string) {
  const fd = openSync(path, 'r')

  try {
    fsyncSync(fd)
  }
  finally {
    closeSync(fd)
  }
}

/** Запись с fsync; новый файл — только для владельца */
export function writeDurable(path: string, data: string | Buffer) {
  const fd = openSync(path, 'w', 0o600)

  try {
    if (typeof data === 'string')
      writeSync(fd, data)
    else writeSync(fd, data)

    fsyncSync(fd)
  }
  finally {
    closeSync(fd)
  }
}

/** Временный файл, fsync, rename и fsync каталога: файл целиком или прежний */
export function replaceDurable(path: string, data: string) {
  const tmp = `${path}.tmp`

  writeDurable(tmp, data)
  renameSync(tmp, path)
  syncDir(dirname(path))
}

export function readKeyFile(path: string) {
  try {
    return decodeKeyFile(readFileSync(path, 'utf8'))
  }
  catch {
    return undefined
  }
}

/** Тот же формат, что у файла ключа секретов */
export function writeKeyFile(path: string, key: Buffer) {
  writeDurable(path, `${key.toString('base64')}\n`)
}

/** Подмена `chmod` в тестах: ФС без прав POSIX (часть NAS) отвечает EPERM */
export const fileDeps = { chmod }

/**
 * Права «по возможности»: при создании они уже заданы через `mode`, а
 * `chmod` нужен для каталога, созданного раньше. Отказ — не сбой копии.
 */
export async function tryChmod(path: string, mode: number) {
  try {
    await fileDeps.chmod(path, mode)
  }
  catch (err) {
    logFor('backups').debug(
      { err, mode: mode.toString(8) },
      'Could not change permissions',
    )
  }
}
