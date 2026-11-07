/**
 * Точки перемотки видео MKV из индекса `Cues` без чтения файла: заголовок
 * (`SeekHead`, `Info`, `Tracks`) — из начала, сам индекс — диапазоном по
 * адресу из `SeekHead`. На эти точки встаёт `-ss` ffmpeg, поэтому по ним
 * строятся границы сегментов HLS.
 */

/** Байты файла `[start, end)`; конец за пределами файла обрезается */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>

const ID = {
  ebml: 0x1A45DFA3,
  segment: 0x18538067,
  seekHead: 0x114D9B74,
  seek: 0x4DBB,
  seekId: 0x53AB,
  seekPosition: 0x53AC,
  info: 0x1549A966,
  timestampScale: 0x2AD7B1,
  tracks: 0x1654AE6B,
  trackEntry: 0xAE,
  trackNumber: 0xD7,
  trackType: 0x83,
  cues: 0x1C53BB6B,
  cuePoint: 0xBB,
  cueTime: 0xB3,
  cueTrackPositions: 0xB7,
  cueTrack: 0xF7,
  cluster: 0x1F43B675,
}

const VIDEO_TRACK = 1
const PREFIX_BYTES = 256 * 1024
const MAX_ELEMENT_BYTES = 64 * 1024 * 1024
const DEFAULT_TIMESTAMP_SCALE = 1_000_000

interface Element {
  id: number
  /** Начало данных элемента в буфере */
  data: number
  /** null — размер неизвестен (живой поток), элемент тянется до конца родителя */
  size: number | null
  /** Конец элемента в буфере */
  end: number
}

function vintLength(first: number) {
  for (let i = 0; i < 8; i++) {
    if (first & (0x80 >> i))
      return i + 1
  }

  return 0
}

function readId(buffer: Uint8Array, offset: number) {
  const length = vintLength(buffer[offset] ?? 0)

  if (length === 0 || length > 4 || offset + length > buffer.length)
    return null

  let id = 0

  for (let i = 0; i < length; i++) id = id * 256 + buffer[offset + i]!

  return { id, length }
}

function readSize(buffer: Uint8Array, offset: number) {
  const first = buffer[offset] ?? 0
  const length = vintLength(first)

  if (length === 0 || offset + length > buffer.length)
    return null

  let value = first & (0xFF >> length)
  let unknown = value === 0xFF >> length

  for (let i = 1; i < length; i++) {
    const byte = buffer[offset + i]!

    value = value * 256 + byte
    unknown &&= byte === 0xFF
  }

  return { size: unknown ? null : value, length }
}

function readElement(buffer: Uint8Array, offset: number, limit: number) {
  const id = readId(buffer, offset)

  if (!id)
    return null

  const size = readSize(buffer, offset + id.length)

  if (!size)
    return null

  const data = offset + id.length + size.length
  const end = size.size === null ? limit : data + size.size

  return { id: id.id, data, size: size.size, end } satisfies Element
}

/** Дочерние элементы в пределах `[from, to)`; обрезанный хвост буфера пропускается */
function* children(buffer: Uint8Array, from: number, to: number) {
  let offset = from
  const limit = Math.min(to, buffer.length)

  while (offset < limit) {
    const element = readElement(buffer, offset, limit)

    if (!element)
      return

    yield element

    if (element.end <= offset)
      return
    offset = element.end
  }
}

function readUint(buffer: Uint8Array, element: Element) {
  let value = 0
  const end = Math.min(element.end, buffer.length)

  for (let i = element.data; i < end; i++) value = value * 256 + buffer[i]!

  return value
}

function childValue(buffer: Uint8Array, parent: Element, id: number) {
  for (const child of children(buffer, parent.data, parent.end)) {
    if (child.id === id)
      return readUint(buffer, child)
  }

  return undefined
}

function seekPositions(buffer: Uint8Array, seekHead: Element) {
  const positions = new Map<number, number>()

  for (const seek of children(buffer, seekHead.data, seekHead.end)) {
    if (seek.id !== ID.seek)
      continue

    let id: number | undefined
    let position: number | undefined

    for (const field of children(buffer, seek.data, seek.end)) {
      if (field.id === ID.seekId)
        id = readUint(buffer, field)
      else if (field.id === ID.seekPosition)
        position = readUint(buffer, field)
    }

    if (id !== undefined && position !== undefined && !positions.has(id))
      positions.set(id, position)
  }

  return positions
}

function videoTrackNumber(buffer: Uint8Array, tracks: Element) {
  for (const entry of children(buffer, tracks.data, tracks.end)) {
    if (
      entry.id === ID.trackEntry
      && childValue(buffer, entry, ID.trackType) === VIDEO_TRACK
    ) {
      return childValue(buffer, entry, ID.trackNumber)
    }
  }

  return undefined
}

function cueTimes(
  buffer: Uint8Array,
  cues: Element,
  track: number | undefined,
) {
  const times: number[] = []

  for (const point of children(buffer, cues.data, cues.end)) {
    if (point.id !== ID.cuePoint)
      continue

    let time: number | undefined
    let forTrack = false

    for (const field of children(buffer, point.data, point.end)) {
      if (field.id === ID.cueTime) {
        time = readUint(buffer, field)
      }
      else if (field.id === ID.cueTrackPositions) {
        const cueTrack = childValue(buffer, field, ID.cueTrack)

        forTrack ||= track === undefined || cueTrack === track
      }
    }

    if (time !== undefined && forTrack)
      times.push(time)
  }

  return times
}

/** Элемент верхнего уровня по адресу из `SeekHead` — отдельным диапазоном */
async function fetchElement(
  read: RangeReader,
  segmentData: number,
  position: number,
  id: number,
) {
  const start = segmentData + position
  const head = await read(start, start + 12)
  const element = readElement(head, 0, head.length)

  if (!element || element.id !== id || element.size === null)
    return null

  if (element.size > MAX_ELEMENT_BYTES)
    return null

  const length = element.data + element.size
  const buffer = await read(start, start + length)

  // Файл короче, чем обещает заголовок элемента: индекс битый
  if (buffer.length < length)
    return null

  return { buffer, element: readElement(buffer, 0, buffer.length)! }
}

/**
 * Время точек `Cues` видеодорожки в секундах, по возрастанию, без повторов.
 * null — файл не MKV, индекса нет или его не удалось прочитать.
 */
export async function readCueTimes(
  read: RangeReader,
): Promise<number[] | null> {
  const prefix = await read(0, PREFIX_BYTES)
  let segment: Element | null = null

  for (const element of children(prefix, 0, prefix.length)) {
    if (element.id === ID.segment) {
      segment = element
      break
    }

    if (element.id !== ID.ebml)
      return null
  }

  if (!segment)
    return null

  let positions = new Map<number, number>()
  let scale: number | undefined
  let track: number | undefined

  for (const element of children(prefix, segment.data, segment.end)) {
    if (element.id === ID.cluster)
      break

    if (element.id === ID.seekHead && positions.size === 0)
      positions = seekPositions(prefix, element)
    else if (element.id === ID.info)
      scale = childValue(prefix, element, ID.timestampScale)
    else if (element.id === ID.tracks)
      track = videoTrackNumber(prefix, element)
  }

  const cuesPosition = positions.get(ID.cues)

  if (cuesPosition === undefined)
    return null

  // `Tracks` и `Info` обычно в начале; если нет — тоже по `SeekHead`
  if (track === undefined && positions.has(ID.tracks)) {
    const tracks = await fetchElement(
      read,
      segment.data,
      positions.get(ID.tracks)!,
      ID.tracks,
    )

    if (tracks)
      track = videoTrackNumber(tracks.buffer, tracks.element)
  }

  if (scale === undefined && positions.has(ID.info)) {
    const info = await fetchElement(
      read,
      segment.data,
      positions.get(ID.info)!,
      ID.info,
    )

    if (info)
      scale = childValue(info.buffer, info.element, ID.timestampScale)
  }

  const cues = await fetchElement(read, segment.data, cuesPosition, ID.cues)

  if (!cues)
    return null

  const nanoseconds = scale ?? DEFAULT_TIMESTAMP_SCALE
  const times = cueTimes(cues.buffer, cues.element, track)
    .map(time => (time * nanoseconds) / 1e9)
    .sort((a, b) => a - b)

  return times.filter((time, i) => i === 0 || time !== times[i - 1])
}

/**
 * Indexed UTF-8 subtitles spanning a seek. Matroska Cues supplies duration
 * and the block's exact location; reading video from zero is unnecessary.
 * https://www.matroska.org/technical/cues.html
 * Unsupported/encoded tracks keep using ffmpeg's normal extraction path.
 */
export async function readSubtitleIndex(read: RangeReader) {
  const prefix = await read(0, PREFIX_BYTES)
  const segment = [...children(prefix, 0, prefix.length)].find(
    element => element.id === ID.segment,
  )
  if (!segment)
    return null
  const headers = [...children(prefix, segment.data, segment.end)]
  const seek = headers.find(element => element.id === ID.seekHead)
  if (!seek)
    return null
  const positions = seekPositions(prefix, seek)
  const load = async (id: number) => {
    const here = headers.find(
      element => element.id === id && element.end <= prefix.length,
    )
    if (here)
      return { buffer: prefix, element: here }
    const at = positions.get(id)
    return at === undefined ? null : fetchElement(read, segment.data, at, id)
  }
  const tracks = await load(ID.tracks)
  const info = await load(ID.info)
  const index = await load(ID.cues)
  if (!tracks || !index)
    return null
  const scale
    = ((info && childValue(info.buffer, info.element, ID.timestampScale))
      ?? DEFAULT_TIMESTAMP_SCALE) / 1e9
  const numbers = new Map<number, number>()
  let stream = 0
  for (const entry of children(
    tracks.buffer,
    tracks.element.data,
    tracks.element.end,
  )) {
    if (entry.id !== ID.trackEntry)
      continue
    const fields = [...children(tracks.buffer, entry.data, entry.end)]
    const codec = fields.find(field => field.id === 0x86)
    const number = childValue(tracks.buffer, entry, ID.trackNumber)
    if (
      number !== undefined
      && codec
      && new TextDecoder().decode(
        tracks.buffer.subarray(codec.data, codec.end),
      ) === 'S_TEXT/UTF8'
      && !fields.some(field => field.id === 0x6D80)
    ) {
      numbers.set(stream, number)
    }
    stream++
  }
  const references: {
    track: number
    start: number
    end: number
    cluster: number
    relative: number
  }[] = []
  for (const point of children(
    index.buffer,
    index.element.data,
    index.element.end,
  )) {
    if (point.id !== ID.cuePoint)
      continue
    const time = childValue(index.buffer, point, ID.cueTime)
    if (time === undefined)
      continue
    for (const position of children(index.buffer, point.data, point.end)) {
      if (position.id !== ID.cueTrackPositions)
        continue
      const track = childValue(index.buffer, position, ID.cueTrack)
      const duration = childValue(index.buffer, position, 0xB2)
      const cluster = childValue(index.buffer, position, 0xF1)
      const relative = childValue(index.buffer, position, 0xF0)
      if (
        track !== undefined
        && duration !== undefined
        && cluster !== undefined
        && relative !== undefined
        && duration > 0
        && Number.isSafeInteger(cluster)
        && Number.isSafeInteger(relative)
      ) {
        references.push({
          track,
          start: time * scale,
          end: (time + duration) * scale,
          cluster,
          relative,
        })
      }
    }
  }
  const cache = new Map<number, string | null>()
  return async (streamIndex: number, at: number) => {
    const track = numbers.get(streamIndex)
    if (track === undefined)
      return []
    const result: { start: number, end: number, text: string }[] = []
    // A corrupt index must not create unbounded random reads per request.
    for (const ref of references
      .filter(
        item => item.track === track && item.start <= at && item.end > at,
      )
      .slice(0, 32)) {
      const clusterAt = segment.data + ref.cluster
      let text = cache.get(clusterAt + ref.relative)
      if (text === undefined) {
        const clusterHead = await read(clusterAt, clusterAt + 12)
        const cluster = readElement(clusterHead, 0, clusterHead.length)
        if (!cluster || cluster.id !== ID.cluster)
          continue
        const blockAt = clusterAt + cluster.data + ref.relative
        const head = await read(blockAt, blockAt + 12)
        const group = readElement(head, 0, head.length)
        if (
          !group
          || ![0xA0, 0xA3].includes(group.id)
          || group.size === null
          || group.size > 128 * 1024
        ) {
          continue
        }
        const bytes = await read(blockAt, blockAt + group.end)
        if (bytes.length < group.end)
          continue
        const block
          = group.id === 0xA3
            ? group
            : [...children(bytes, group.data, group.end)].find(
                item => item.id === 0xA1,
              )
        if (!block || block.end > bytes.length)
          continue
        const blockTrack = readSize(bytes, block.data)
        const payload = block.data + (blockTrack?.length ?? 0) + 3
        if (
          blockTrack?.size !== track
          || payload > block.end
          || (bytes[payload - 1]! & 6) !== 0
        ) {
          continue
        }
        text
          = new TextDecoder('utf-8', { fatal: true })
            .decode(bytes.subarray(payload, block.end))
            .trim() || null
        cache.set(clusterAt + ref.relative, text)
        if (cache.size > 64)
          cache.delete(cache.keys().next().value!)
      }
      if (text)
        result.push({ start: ref.start, end: ref.end, text })
    }
    return result
  }
}
