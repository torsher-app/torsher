import type { TorrentFileEntry } from '../../db/schema.ts'

/** Смещение файла от начала раздачи: файлы, включая выравнивание, идут подряд */
export function fileOffsetOf(files: TorrentFileEntry[], index: number) {
  let offset = 0

  for (let i = 0; i < index; i++) offset += files[i]?.size ?? 0

  return offset
}

function hasPiece(bits: Uint8Array, piece: number) {
  const byte = bits[piece >> 3] ?? 0

  return (byte & (0x80 >> (piece & 7))) !== 0
}

export interface BufferInput {
  bits: Uint8Array
  pieceCount: number
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
  const { bits, pieceCount, pieceLength, fileOffset, fileSize } = input
  const position = Math.min(Math.max(input.position, 0), fileSize)
  const start = fileOffset + position
  const fileEnd = fileOffset + fileSize

  if (position >= fileSize)
    return 0

  let piece = Math.floor(start / pieceLength)

  while (
    piece < pieceCount
    && piece * pieceLength < fileEnd
    && hasPiece(bits, piece)
  ) {
    piece++
  }

  const end = Math.min(piece * pieceLength, fileEnd)

  return Math.max(0, end - start)
}

const RESUME_MIN_SECONDS = 30
const RESUME_TAIL_SECONDS = 120
const RESUME_TAIL_SHARE = 0.05

/**
 * Позиция, с которой предложить продолжить. В самом начале продолжать нечего,
 * у самого конца файл считается досмотренным — предлагаем начать сначала.
 */
export function resumePosition(position: number, duration: number | null) {
  if (position < RESUME_MIN_SECONDS)
    return null

  if (duration) {
    const tail = Math.min(RESUME_TAIL_SECONDS, duration * RESUME_TAIL_SHARE)

    if (duration - position <= tail)
      return null
  }

  return position
}
