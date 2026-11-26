import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { getAddonLaunch } from './streams.ts'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseRange } from '../library/stream.ts'
import { isMatroskaDocument } from '../media/matroska.ts'
import { currentAddon, fetchAddonAsset, safeAddonText } from './index.ts'

export type AddonLaunch = NonNullable<ReturnType<typeof getAddonLaunch>>
type Asset = Awaited<ReturnType<typeof fetchAddonAsset>>
interface ByteRange {
  start: number
  end: number
}

const PROBE_BYTES = 4096
const MAX_READ_BYTES = 16 * 1024 * 1024
const MAX_CONCURRENT_READS = 4

interface Representation {
  size: number
  etag: string | undefined
  url: string
  container: 'mp4' | 'mkv'
}

export class AddonMediaError extends Error {
  constructor() {
    super('HTTP video is unavailable')
    this.name = 'AddonMediaError'
  }
}

function responseRange(response: Response) {
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    response.headers.get('content-range') ?? '',
  )
  if (response.status !== 206 || !range || !response.body)
    throw new AddonMediaError()
  const [, from, to, total] = range
  const start = Number(from)
  const end = Number(to)
  const size = Number(total)
  const length = response.headers.get('content-length')
  const encoding = response.headers.get('content-encoding')
  if (
    ![start, end, size].every(Number.isSafeInteger)
    || start > end
    || end >= size
    || (encoding !== null && encoding.toLowerCase() !== 'identity')
    || (length !== null
      && (!/^\d+$/.test(length) || Number(length) !== end - start + 1))
  ) {
    throw new AddonMediaError()
  }
  const etag = response.headers.get('etag')
  return {
    start,
    end,
    size,
    etag: etag && /^"[\x21\x23-\x7E]*"$/.test(etag) ? etag : undefined,
  }
}

function streamBody(asset: Asset, length: number, invalid?: () => void) {
  const stream = Readable.from(
    (async function* () {
      const reader = asset.response.body!.getReader()
      try {
        let remaining = length
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            if (remaining !== 0) {
              invalid?.()
              throw new AddonMediaError()
            }
            return
          }
          if (value.length > remaining) {
            invalid?.()
            throw new AddonMediaError()
          }
          remaining -= value.length
          yield value
        }
      }
      catch {
        // Raw upstream errors may contain provider credentials.
        throw new AddonMediaError()
      }
      finally {
        await asset.close()
        reader.releaseLock()
      }
    })(),
    { objectMode: false },
  )
  stream.once('close', () => {
    void asset.close()
  })
  return stream
}

async function readBytes(asset: Asset, length: number, invalid?: () => void) {
  const result = new Uint8Array(length)
  let offset = 0
  for await (const chunk of streamBody(asset, length, invalid)) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function headerFor(launch: AddonLaunch, range: ByteRange, etag?: string) {
  const headers = new Headers(launch.headers)
  headers.set('range', `bytes=${range.start}-${range.end}`)
  headers.set('accept-encoding', 'identity')
  if (etag)
    headers.set('if-range', etag)
  return headers
}

function sameRepresentation(a: Representation, b: Representation) {
  return (
    a.size === b.size
    && a.etag === b.etag
    && a.url === b.url
    && a.container === b.container
  )
}

async function readRepresentation(
  launch: AddonLaunch,
  signal: AbortSignal,
  expected?: Representation,
) {
  const end = expected
    ? Math.min(expected.size, PROBE_BYTES) - 1
    : PROBE_BYTES - 1
  const asset = await fetchAddonAsset(launch.addon, 'stream', launch.url, {
    headers: headerFor(launch, { start: 0, end }, expected?.etag),
    signal,
  })
  try {
    const range = responseRange(asset.response)
    if (
      range.start !== 0
      || range.end !== Math.min(range.size, PROBE_BYTES) - 1
    ) {
      throw new AddonMediaError()
    }
    const bytes = await readBytes(asset, range.end + 1)
    const mp4
      = bytes.length >= 12
        && bytes[4] === 0x66
        && bytes[5] === 0x74
        && bytes[6] === 0x79
        && bytes[7] === 0x70
    const mkv = isMatroskaDocument(bytes)
    if (!mp4 && !mkv)
      throw new AddonMediaError()
    const representation: Representation = {
      size: range.size,
      etag: range.etag,
      url: asset.url,
      container: mp4 ? 'mp4' : 'mkv',
    }
    if (expected && !sameRepresentation(expected, representation))
      throw new AddonMediaError()
    return representation
  }
  finally {
    await asset.close()
  }
}

export interface AddonMediaResponse {
  status: 200 | 206 | 416
  headers: Record<string, string>
  body?: Readable
}

export class AddonMedia {
  readonly launch: AddonLaunch
  readonly signal: AbortSignal
  readonly revision = randomUUID()
  private readonly closer = new AbortController()
  private readonly bridge = createServer()
  private readonly path = `/addon-media/${randomUUID()}`
  private representation?: Representation
  private active = 0
  failed = false

  constructor(launch: AddonLaunch) {
    this.launch = launch
    this.signal = AbortSignal.any([launch.signal, this.closer.signal])
    this.bridge.on('request', (request, response) => {
      void this.serveBridge(request, response)
    })
    this.signal.addEventListener(
      'abort',
      () => {
        this.bridge.close()
        this.bridge.closeAllConnections()
      },
      { once: true },
    )
  }

  get size() {
    return this.representation?.size ?? 0
  }

  get container() {
    return this.representation?.container
  }

  get url() {
    const address = this.bridge.address() as AddressInfo | null
    if (!address || this.signal.aborted)
      throw new AddonMediaError()
    return `http://127.0.0.1:${address.port}${this.path}.${this.container}`
  }

  get accessible() {
    const { addon } = this.launch
    return (
      !this.signal.aborted && !!currentAddon(addon.id, addon.revision, 'stream')
    )
  }

  async prepare(signal: AbortSignal, previous?: AddonMedia) {
    if (!this.accessible || (previous && !previous.accessible))
      throw new AddonMediaError()
    try {
      const combined = AbortSignal.any([this.signal, signal])
      this.representation = await readRepresentation(
        this.launch,
        combined,
        previous?.representation,
      )
      combined.throwIfAborted()
      if (previous && !previous.accessible)
        throw new AddonMediaError()
      await new Promise<void>((resolve, reject) => {
        this.bridge.once('error', reject)
        this.bridge.listen(
          {
            host: '127.0.0.1',
            port: 0,
            signal: combined,
          },
          () => {
            this.bridge.off('error', reject)
            resolve()
          },
        )
        combined.addEventListener(
          'abort',
          () => reject(new AddonMediaError()),
          { once: true },
        )
      })
      this.bridge.unref()
      combined.throwIfAborted()
    }
    catch {
      throw new AddonMediaError()
    }
  }

  close() {
    this.closer.abort()
  }

  private rejectChangedSource() {
    this.failed = true
    this.close()
  }

  safeText(value: string | null) {
    const { addon, url, headers } = this.launch
    return (
      safeAddonText(addon, value ?? undefined, {
        urls: [url, ...(this.representation ? [this.representation.url] : [])],
        privateValues: [...headers.values(), this.path],
      }) || null
    )
  }

  private async open(range: ByteRange, signal: AbortSignal) {
    const expected = this.representation
    if (!expected || !this.accessible || this.active >= MAX_CONCURRENT_READS)
      throw new AddonMediaError()

    this.active++
    let asset: Asset | undefined
    let released = false
    const controller = AbortSignal.any([signal, this.signal])
    let abort: () => void
    const close = async () => {
      if (released)
        return
      released = true
      controller.removeEventListener('abort', abort)
      this.active--
      await asset?.close()
    }
    abort = () => {
      void close()
    }
    try {
      controller.throwIfAborted()
      asset = await fetchAddonAsset(
        this.launch.addon,
        'stream',
        this.launch.url,
        {
          headers: headerFor(this.launch, range, expected.etag),
          signal: controller,
        },
      )
      controller.throwIfAborted()
      const actual = responseRange(asset.response)
      if (
        actual.start !== range.start
        || actual.end !== range.end
        || actual.size !== expected.size
        || actual.etag !== expected.etag
        || asset.url !== expected.url
      ) {
        throw new AddonMediaError()
      }
      controller.addEventListener('abort', abort, { once: true })
      return { ...asset, close }
    }
    catch {
      if (asset && !controller.aborted)
        this.rejectChangedSource()
      await close()
      throw new AddonMediaError()
    }
  }

  async read(start: number, end: number, signal: AbortSignal) {
    const final = Math.min(end, this.size)
    if (start >= final)
      return new Uint8Array()
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(final)
      || start < 0
      || final - start > MAX_READ_BYTES
    ) {
      throw new AddonMediaError()
    }
    const asset = await this.open({ start, end: final - 1 }, signal)
    return readBytes(asset, final - start, () => this.rejectChangedSource())
  }

  async response(
    range: string | undefined,
    head: boolean,
    signal: AbortSignal,
  ): Promise<AddonMediaResponse> {
    if (!this.representation || !this.accessible)
      throw new AddonMediaError()
    const size = this.representation.size
    const selected = parseRange(range, size)
    const headers: Record<string, string> = {
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'content-type':
        this.container === 'mp4' ? 'video/mp4' : 'video/x-matroska',
      'x-content-type-options': 'nosniff',
    }
    if (selected === null) {
      return {
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${size}` },
      }
    }
    const bytes = selected ?? { start: 0, end: size - 1 }
    const length = bytes.end - bytes.start + 1
    headers['content-length'] = String(length)
    if (selected)
      headers['content-range'] = `bytes ${bytes.start}-${bytes.end}/${size}`
    const body = head
      ? undefined
      : streamBody(await this.open(bytes, signal), length, () =>
          this.rejectChangedSource())
    return { status: selected ? 206 : 200, headers, body }
  }

  private async serveBridge(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    if (
      request.url !== `${this.path}.${this.container}`
      || (request.method !== 'GET' && request.method !== 'HEAD')
    ) {
      response.writeHead(404).end()
      return
    }
    const closer = new AbortController()
    response.once('close', () => closer.abort())
    try {
      const { status, headers, body } = await this.response(
        request.headers.range,
        request.method === 'HEAD',
        closer.signal,
      )
      response.writeHead(status, headers)
      if (body)
        await pipeline(body, response)
      else response.end()
    }
    catch {
      if (!response.headersSent)
        response.writeHead(502).end()
      else response.destroy()
    }
  }
}
