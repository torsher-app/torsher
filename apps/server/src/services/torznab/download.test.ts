import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadTorrent, TORRENT_FILE_MAX_BYTES } from './client.ts'

const fetchMock = vi.fn<typeof fetch>()
const LINK = 'https://indexer.example/download/1?apikey=k'

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
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
})
