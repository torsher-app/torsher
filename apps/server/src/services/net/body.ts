import { Buffer } from 'node:buffer'

export class BodyTooLargeError extends Error {
  constructor() {
    super('Response body is too large')
    this.name = 'BodyTooLargeError'
  }
}

/**
 * Тело ответа не больше `maxBytes`: чтение обрывается, как только предел
 * превышен, а не после загрузки всего тела в память.
 */
export async function readBodyLimited(res: Response, maxBytes: number) {
  const length = Number(res.headers.get('content-length'))

  if (length > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new BodyTooLargeError()
  }

  if (!res.body)
    return Buffer.alloc(0)

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done)
      break

    total += value.byteLength

    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError()
    }

    chunks.push(value)
  }

  return Buffer.concat(chunks, total)
}
