import type { Buffer } from 'node:buffer'

/** Identify legacy public metainfo locally, even while the engine is offline. */
export function isPublicMetainfo(bytes: Buffer) {
  let offset = 0
  const invalid = new Error('Invalid metainfo')

  function string() {
    const start = offset
    while (
      bytes[offset] !== undefined
      && bytes[offset]! >= 48
      && bytes[offset]! <= 57
    ) {
      offset++
    }
    if (offset === start || offset - start > 9 || bytes[offset++] !== 58)
      throw invalid
    const length = Number(bytes.toString('ascii', start, offset - 1))
    const value = bytes.subarray(offset, offset + length)
    offset += length
    if (offset > bytes.length)
      throw invalid
    return value
  }

  function skip(depth: number) {
    if (depth > 64)
      throw invalid
    switch (bytes[offset]) {
      case 100: // d
        dictionary(() => skip(depth + 1))
        return
      case 108: // l
        offset++
        while (bytes[offset] !== 101) skip(depth + 1)
        offset++
        return
      case 105: {
        // i
        const end = bytes.indexOf(101, ++offset)
        if (
          end < 0
          || !/^-?(?:0|[1-9]\d*)$/.test(bytes.toString('latin1', offset, end))
        ) {
          throw invalid
        }
        offset = end + 1
        return
      }
      default:
        string()
    }
  }

  function dictionary(readValue: (key: string) => void) {
    if (bytes[offset++] !== 100)
      throw invalid
    while (bytes[offset] !== 101) readValue(string().toString('latin1'))
    offset++
  }

  try {
    let infoSeen = false
    let privateSeen = false
    dictionary((key) => {
      if (key !== 'info') {
        skip(1)
        return
      }
      if (infoSeen)
        throw invalid
      infoSeen = true
      dictionary((field) => {
        if (field === 'private') {
          if (
            privateSeen
            || bytes.toString('ascii', offset, offset + 3) !== 'i0e'
          ) {
            throw invalid
          }
          privateSeen = true
        }
        skip(2)
      })
    })
    return infoSeen && offset === bytes.length
  }
  catch (error) {
    if (error !== invalid)
      throw error
    // Unknown and nonzero values go through the engine's authoritative parser.
    return false
  }
}
