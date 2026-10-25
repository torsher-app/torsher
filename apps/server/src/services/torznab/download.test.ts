import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { netResolveDeps } from '../net/index.ts'
import { downloadTorrent, TORRENT_FILE_MAX_BYTES } from './client.ts'

const fetchMock = vi.fn<typeof fetch>()
const LINK = 'https://indexer.example/download/1?apikey=k'

const routeAddresses = vi.spyOn(netResolveDeps, 'routeAddresses')

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  routeAddresses.mockReset()
  routeAddresses.mockResolvedValue(['203.0.113.10'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('downloadTorrent', () => {
  it('отдаёт байты .torrent', async () => {
    fetchMock.mockResolvedValue(new Response('d4:infod4:name1:aee'))

    const result = await downloadTorrent(LINK)

    expect(result.kind).toBe('file')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
  })

  it('редирект на magnet возвращает magnet', async () => {
    const magnet = `magnet:?xt=urn:btih:${'0'.repeat(40)}`

    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: magnet } }),
    )

    await expect(downloadTorrent(LINK)).resolves.toEqual({
      kind: 'magnet',
      magnet,
    })
  })

  it('идёт по http-редиректу', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: '/real/1' } }),
      )
      .mockResolvedValueOnce(new Response('d1:ai1ee'))

    await downloadTorrent(LINK)

    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      'https://indexer.example/real/1',
    )
  })

  it.each([
    ['не bencode', () => new Response('<html>error</html>'), 'bad_response'],
    [
      'слишком большой',
      () =>
        new Response('d', {
          headers: { 'content-length': String(TORRENT_FILE_MAX_BYTES + 1) },
        }),
      'bad_response',
    ],
    ['403', () => new Response('', { status: 403 }), 'auth'],
    ['500', () => new Response('', { status: 500 }), 'remote'],
  ])('%s — SourceError', async (_, response, kind) => {
    fetchMock.mockImplementation(async () => response())

    await expect(downloadTorrent(LINK)).rejects.toMatchObject({ kind })
  })

  it('обрывает чтение потока больше предела', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++

          if (pulls > 20)
            controller.close()
          else controller.enqueue(new Uint8Array(1024 * 1024).fill(0x64))
        },
      },
      { highWaterMark: 0 },
    )

    fetchMock.mockResolvedValue(new Response(body))

    await expect(downloadTorrent(LINK)).rejects.toMatchObject({
      kind: 'bad_response',
      message: 'Torrent file is too large',
    })
    expect(pulls).toBeLessThan(20)
  })

  it('не ходит по ссылке на loopback', async () => {
    await expect(
      downloadTorrent('http://127.0.0.1:1234/x.torrent'),
    ).rejects.toMatchObject({ kind: 'bad_response' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ходит на loopback, если там сам индексатор', async () => {
    fetchMock.mockResolvedValue(new Response('d1:ai1ee'))

    await downloadTorrent('http://127.0.0.1:9117/dl/x', 1000, {
      trustedOrigin: 'http://127.0.0.1:9117',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('не ходит на другой порт хоста индексатора', async () => {
    await expect(
      downloadTorrent('http://127.0.0.1:8090/torrents/x/files/0/stream', 1000, {
        trustedOrigin: 'http://127.0.0.1:9117',
      }),
    ).rejects.toMatchObject({ kind: 'bad_response' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('не идёт с индексатора по редиректу на другой порт loopback', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: 'http://127.0.0.1:8090/torrents/x/files/0/stream',
        },
      }),
    )

    await expect(
      downloadTorrent('http://127.0.0.1:9117/dl/x', 1000, {
        trustedOrigin: 'http://127.0.0.1:9117',
      }),
    ).rejects.toMatchObject({ kind: 'bad_response' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('не ходит по имени, которое разрешается в loopback', async () => {
    routeAddresses.mockResolvedValue(['127.0.0.1'])

    await expect(
      downloadTorrent('http://127.0.0.1.nip.io:8090/x.torrent'),
    ).rejects.toMatchObject({
      kind: 'bad_response',
      message: 'Torrent link points to a local address',
    })
    expect(routeAddresses).toHaveBeenCalledWith('127.0.0.1.nip.io')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ходит по имени, которое разрешается в локальную сеть', async () => {
    routeAddresses.mockResolvedValue(['192.168.1.5'])
    fetchMock.mockResolvedValue(new Response('d1:ai1ee'))

    await expect(
      downloadTorrent('http://jackett:9117/dl/x'),
    ).resolves.toMatchObject({ kind: 'file' })
  })

  it('освобождает тело редиректа перед переходом', async () => {
    let cancelled = false
    const body = new ReadableStream({
      cancel() {
        cancelled = true
      },
    })

    fetchMock
      .mockResolvedValueOnce(
        new Response(body, { status: 302, headers: { location: '/real/1' } }),
      )
      .mockResolvedValueOnce(new Response('d1:ai1ee'))

    await downloadTorrent(LINK)

    expect(cancelled).toBe(true)
  })

  it('не идёт по редиректу на loopback', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: 'http://127.0.0.1:8090/torrents/x/files/0/stream',
        },
      }),
    )

    await expect(downloadTorrent(LINK)).rejects.toMatchObject({
      kind: 'bad_response',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ходит в локальную сеть', async () => {
    fetchMock.mockResolvedValue(new Response('d1:ai1ee'))

    await expect(
      downloadTorrent('http://192.168.1.5:9117/dl/x'),
    ).resolves.toMatchObject({ kind: 'file' })
  })
})
