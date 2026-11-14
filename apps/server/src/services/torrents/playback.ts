import type { CueCluster } from '../media/matroska.ts'
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

/**
 * v1 may include explicit padding; hybrid/v2 may expose only aligned files.
 * Bitmap length can disambiguate the layouts. When it cannot, every candidate
 * must verify the bytes: a neighbouring file's piece is never proof.
 */
export function verifiedFileOffsets(
  files: TorrentFileEntry[],
  index: number,
  pieceLength: number,
  pieceCount: number,
) {
  if (
    !Number.isSafeInteger(pieceLength)
    || pieceLength <= 0
    || !Number.isSafeInteger(pieceCount)
    || pieceCount <= 0
    || !files[index]
  ) {
    return []
  }
  let linear = 0
  let aligned = 0
  let linearOffset = 0
  let alignedOffset = 0
  for (let i = 0; i < files.length; i++) {
    const size = files[i]!.size
    if (!Number.isSafeInteger(size) || size < 0)
      return []
    if (i === index) {
      linearOffset = linear
      alignedOffset = aligned
    }
    linear += size
    aligned += Math.ceil(size / pieceLength) * pieceLength
    if (!Number.isSafeInteger(linear) || !Number.isSafeInteger(aligned))
      return []
  }
  const offsets: number[] = []
  if (Math.ceil(linear / pieceLength) === pieceCount)
    offsets.push(linearOffset)
  if (aligned / pieceLength === pieceCount && !offsets.includes(alignedOffset))
    offsets.push(alignedOffset)
  return offsets
}

export interface VerifiedBufferInput extends Omit<
  BufferInput,
  'fileOffset' | 'position'
> {
  fileOffsets: number[]
}

export function verifiedBufferedAheadBytes(
  input: VerifiedBufferInput,
  position: number,
) {
  if (!input.fileOffsets.length)
    return null
  return Math.min(
    ...input.fileOffsets.map(fileOffset =>
      bufferedAheadBytes({ ...input, fileOffset, position }),
    ),
  )
}

export interface PlaybackCache {
  sampledAtSeconds: number
  anchorOffset: number
  contiguousEndOffset: number
  /** Conservative absolute end time; null means no proven time bound. */
  bufferedUntilSeconds: number | null
  /** All bytes from anchor through EOF passed piece hash verification. */
  verifiedToEnd: boolean
}

/** Time mapping uses indexed clusters only, never average file bitrate. */
export function playbackCacheAt(
  input: VerifiedBufferInput,
  time: number,
  duration: number | null,
  index: CueCluster[] | null,
): PlaybackCache | null {
  const durationKnown
    = duration !== null && Number.isFinite(duration) && duration > 0
  const full = verifiedBufferedAheadBytes(input, 0) === input.fileSize
  if (!input.fileOffsets.length)
    return null
  if (full && input.fileSize > 0) {
    return {
      sampledAtSeconds: time,
      anchorOffset: 0,
      contiguousEndOffset: input.fileSize,
      bufferedUntilSeconds: durationKnown ? duration : null,
      verifiedToEnd: true,
    }
  }
  if (
    !index?.length
    || time < index[0]!.minTime
    || (durationKnown && index.at(-1)!.maxTime > duration! + 1)
  ) {
    return null
  }
  let anchor = 0
  for (let i = 1; i < index.length && index[i]!.minTime <= time; i++)
    anchor = i
  const cluster = index[anchor]!
  const end
    = cluster.offset + (verifiedBufferedAheadBytes(input, cluster.offset) ?? 0)
  const verifiedToEnd = end === input.fileSize
  if (time > index.at(-1)!.maxTime && !verifiedToEnd)
    return null
  let bufferedUntilSeconds: number | null = null
  // A cue can lie anywhere inside its cluster. Its time is proven only after
  // the entire containing cluster is contiguous, up to the next cluster (or EOF).
  for (let i = anchor; i < index.length; i++) {
    const boundary = index[i + 1]?.offset ?? input.fileSize
    if (end < boundary)
      break
    bufferedUntilSeconds = durationKnown
      ? Math.min(duration!, index[i]!.maxTime)
      : index[i]!.maxTime
  }
  if (verifiedToEnd && durationKnown)
    bufferedUntilSeconds = duration
  return {
    sampledAtSeconds: time,
    anchorOffset: cluster.offset,
    contiguousEndOffset: end,
    bufferedUntilSeconds,
    verifiedToEnd,
  }
}

// Последние 10% — титры: фильм, остановленный на них, досмотрен. Титры у
// фильмов идут 8–12 минут, хвост в минутах их не покрывает
const RESUME_MIN_SHARE = 0.05
const WATCHED_SHARE = 0.9
const RESUME_MIN_DURATION = 300
// Длительность знает только плеер: без неё досмотренным файл не считается,
// а продолжать есть смысл с первых минут
const RESUME_MIN_SECONDS = 30

/**
 * Досмотрено: позиция после 90% или в последней секунде. Файл короче пяти
 * минут продолжать нечего — он досмотрен, как только начат.
 */
export function isWatched(position: number, duration: number | null) {
  if (!duration || duration <= 0)
    return false

  const share = position / duration

  if (share < RESUME_MIN_SHARE)
    return false

  return (
    share > WATCHED_SHARE
    || position >= duration - 1
    || duration < RESUME_MIN_DURATION
  )
}

/**
 * Позиция, с которой плеер продолжает сам. В первых 5% продолжать нечего,
 * досмотренный файл играем с начала.
 */
export function resumePosition(position: number, duration: number | null) {
  if (!duration || duration <= 0)
    return position < RESUME_MIN_SECONDS ? null : position

  if (position / duration < RESUME_MIN_SHARE)
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
