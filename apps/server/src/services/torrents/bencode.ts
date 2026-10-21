type BencodeValue
  = number | Uint8Array | BencodeValue[] | { [key: string]: BencodeValue }

const COLON = 0x3A
const E = 0x65

/** Минимальный разбор bencode: строки остаются байтами, ключи словарей — текстом */
function decodeAt(bytes: Uint8Array, start: number): [BencodeValue, number] {
  const head = bytes[start]

  if (head === undefined)
    throw new SyntaxError('Unexpected end of bencode')

  // i<число>e
  if (head === 0x69) {
    const end = bytes.indexOf(E, start)

    if (end === -1)
      throw new SyntaxError('Unterminated integer')

    const text = new TextDecoder().decode(bytes.subarray(start + 1, end))

    if (!/^-?\d+$/.test(text))
      throw new SyntaxError('Invalid integer')

    return [Number(text), end + 1]
  }

  // l<значения>e
  if (head === 0x6C) {
    const list: BencodeValue[] = []
    let pos = start + 1

    while (bytes[pos] !== E) {
      const [value, next] = decodeAt(bytes, pos)

      list.push(value)
      pos = next
    }

    return [list, pos + 1]
  }

  // d<ключ><значение>...e
  if (head === 0x64) {
    const dict: { [key: string]: BencodeValue } = {}
    let pos = start + 1

    while (bytes[pos] !== E) {
      const [key, afterKey] = decodeAt(bytes, pos)

      if (!(key instanceof Uint8Array))
        throw new SyntaxError('Dictionary key must be a string')

      const [value, next] = decodeAt(bytes, afterKey)

      dict[new TextDecoder().decode(key)] = value
      pos = next
    }

    return [dict, pos + 1]
  }

  // <длина>:<байты>
  const colon = bytes.indexOf(COLON, start)

  if (colon === -1)
    throw new SyntaxError('Invalid string length')

  const lengthText = new TextDecoder().decode(bytes.subarray(start, colon))

  if (!/^\d+$/.test(lengthText))
    throw new SyntaxError('Invalid string length')

  const end = colon + 1 + Number(lengthText)

  if (end > bytes.length)
    throw new SyntaxError('Unexpected end of bencode')

  return [bytes.subarray(colon + 1, end), end]
}

export function decodeBencode(bytes: Uint8Array) {
  return decodeAt(bytes, 0)[0]
}

/** Размер куска из `.torrent`: от него считается буфер впереди позиции чтения */
export function readPieceLength(torrentFile: Uint8Array) {
  try {
    const root = decodeBencode(torrentFile)

    if (
      typeof root !== 'object'
      || root instanceof Uint8Array
      || Array.isArray(root)
    ) {
      return null
    }

    const info = root.info

    if (
      typeof info !== 'object'
      || info instanceof Uint8Array
      || Array.isArray(info)
    ) {
      return null
    }

    const pieceLength = info['piece length']

    return typeof pieceLength === 'number' && pieceLength > 0
      ? pieceLength
      : null
  }
  catch {
    return null
  }
}
