import type { TorrentFileEntry } from '../../db/schema.ts'

/** Смещение файла от начала раздачи: файлы, включая выравнивание, идут подряд */
export function fileOffsetOf(files: TorrentFileEntry[], index: number) {
  let offset = 0

  for (let i = 0; i < index; i++) offset += files[i]?.size ?? 0

  return offset
}

export interface BufferInput {
  /** Скачанные куски строкой из 0 и 1 по порядку кусков */
  pieces: string
  pieceLength: number
  fileOffset: number
  fileSize: number
  /** Позиция чтения в байтах от начала файла */
  position: number
}

/**
 * Сколько байт файла скачано подряд от позиции чтения: столько плеер
 * проиграет без ожидания пиров. Кусок на позиции не скачан — ноль.
 */
export function bufferedAheadBytes(input: BufferInput) {
  const { pieces, pieceLength, fileOffset, fileSize } = input
  const position = Math.min(Math.max(input.position, 0), fileSize)
  const start = fileOffset + position
  const fileEnd = fileOffset + fileSize

  if (position >= fileSize)
    return 0

  let piece = Math.floor(start / pieceLength)

  while (
    piece < pieces.length
    && piece * pieceLength < fileEnd
    && pieces[piece] === '1'
  ) {
    piece++
  }

  const end = Math.min(piece * pieceLength, fileEnd)

  return Math.max(0, end - start)
}

const RESUME_MIN_SECONDS = 30
const RESUME_TAIL_SECONDS = 120
const RESUME_TAIL_SHARE = 0.05

function tailOf(duration: number) {
  return Math.min(RESUME_TAIL_SECONDS, duration * RESUME_TAIL_SHARE)
}

/** Досмотрено: позиция в хвосте файла, где продолжать уже нечего */
export function isWatched(position: number, duration: number | null) {
  return !!duration && duration - position <= tailOf(duration)
}

/**
 * Позиция, с которой плеер продолжает сам. В самом начале продолжать нечего,
 * у самого конца файл считается досмотренным — играем с начала.
 */
export function resumePosition(position: number, duration: number | null) {
  if (position < RESUME_MIN_SECONDS)
    return null

  return isWatched(position, duration) ? null : position
}

const MIB = 1024 * 1024
// Запас впереди позиции при просмотре: столько видео докачивается вперёд,
// пока поток открыт. Без длительности — окно среднего размера
const STREAM_AHEAD_SECONDS = 180
const MIN_STREAM_WINDOW = 64 * MIB
const MAX_STREAM_WINDOW = 1024 * MIB
const DEFAULT_STREAM_WINDOW = 128 * MIB

/** Окно просмотра в байтах: три минуты видео по среднему битрейту файла */
export function streamWindowOf(size: number, duration: number | null) {
  if (!duration || duration <= 0 || size <= 0)
    return DEFAULT_STREAM_WINDOW

  const window = (size / duration) * STREAM_AHEAD_SECONDS

  return Math.round(
    Math.min(MAX_STREAM_WINDOW, Math.max(MIN_STREAM_WINDOW, window)),
  )
}
