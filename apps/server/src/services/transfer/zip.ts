import { Buffer } from 'node:buffer'
import { inflateRawSync } from 'node:zlib'

const END_OF_CENTRAL_DIR = 0x06054B50
const CENTRAL_FILE_HEADER = 0x02014B50
const LOCAL_FILE_HEADER = 0x04034B50
// Запись конца каталога — 22 байта плюс комментарий архива до 64 КБ
const MAX_EOCD_SEARCH = 22 + 0xFFFF

const STORED = 0
const DEFLATE = 8

export class ZipError extends Error {}

export interface ZipEntry {
  name: string
  data: Buffer
}

export function isZip(data: Buffer) {
  return data.length >= 4 && data.readUInt32LE(0) === LOCAL_FILE_HEADER
}

function findEndOfCentralDir(data: Buffer) {
  const stop = Math.max(0, data.length - MAX_EOCD_SEARCH)

  for (let offset = data.length - 22; offset >= stop; offset--) {
    if (data.readUInt32LE(offset) === END_OF_CENTRAL_DIR)
      return offset
  }

  throw new ZipError('Not a zip archive')
}

/**
 * Смещения и размеры берутся из самого архива: выход за буфер или битый
 * deflate — тоже порча архива, а не сбой сервера
 */
export function readZip(
  data: Buffer,
  accept: (name: string) => boolean,
  maxBytes: number,
): ZipEntry[] {
  try {
    return readEntries(data, accept, maxBytes)
  }
  catch (err) {
    if (err instanceof ZipError)
      throw err

    throw new ZipError('Broken zip archive', { cause: err })
  }
}

/**
 * Читает архив целиком в памяти: файлы экспорта сервисов маленькие.
 * Только stored и deflate, без zip64 и шифрования. `maxBytes` — предел
 * распакованного объёма, чтобы архив-бомба не съел память.
 */
function readEntries(
  data: Buffer,
  accept: (name: string) => boolean,
  maxBytes: number,
): ZipEntry[] {
  const eocd = findEndOfCentralDir(data)
  const count = data.readUInt16LE(eocd + 10)
  let offset = data.readUInt32LE(eocd + 16)
  let total = 0
  const entries: ZipEntry[] = []

  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > data.length
      || data.readUInt32LE(offset) !== CENTRAL_FILE_HEADER
    ) {
      throw new ZipError('Broken zip directory')
    }

    const flags = data.readUInt16LE(offset + 8)
    const method = data.readUInt16LE(offset + 10)
    const compressedSize = data.readUInt32LE(offset + 20)
    const size = data.readUInt32LE(offset + 24)
    const nameLength = data.readUInt16LE(offset + 28)
    const extraLength = data.readUInt16LE(offset + 30)
    const commentLength = data.readUInt16LE(offset + 32)
    const localOffset = data.readUInt32LE(offset + 42)
    const name = data
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8')

    offset += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/') || !accept(name))
      continue

    if (flags & 0x1)
      throw new ZipError('Encrypted zip entries are not supported')

    total += size

    if (total > maxBytes)
      throw new ZipError('Archive is too large')

    if (data.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER)
      throw new ZipError('Broken zip entry')

    const start
      = localOffset
        + 30
        + data.readUInt16LE(localOffset + 26)
        + data.readUInt16LE(localOffset + 28)
    const raw = data.subarray(start, start + compressedSize)

    if (method === STORED) {
      entries.push({ name, data: Buffer.from(raw) })
    }
    else if (method === DEFLATE) {
      entries.push({
        name,
        data: inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) }),
      })
    }
    else {
      throw new ZipError(`Unsupported zip compression ${method}`)
    }
  }

  return entries
}
