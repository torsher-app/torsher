import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateDb } from '../../db/index.ts'
import { netResolveDeps } from '../net/index.ts'
import { trustedHttpDeps } from '../net/trustedHttp.ts'
import {
  checkNewznab,
  fetchNewznabPage,
  fetchNzb,
  validatedNzb,
} from './client.ts'

const caps = `<caps><limits max="40" default="20"/><searching>
  <search available="yes" supportedParams="q"/>
  <movie-search available="yes" supportedParams="q,imdbid"/>
  </searching><categories><category id="2000" name="Movies"/></categories></caps>`
const nzb = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <file subject="synthetic" date="1" poster="qa@example.test">
    <groups><group>example.test</group></groups>
    <segments><segment bytes="1" number="1">segment@example.test</segment></segments>
  </file>
</nzb>`

const source = {
  url: 'https://manager.example/base/5',
  apiKey: 'fixture-key',
}

beforeAll(() => migrateDb())
afterEach(() => vi.restoreAllMocks())

function mockedTransport() {
  vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue(['8.8.4.4'])
  return vi.spyOn(trustedHttpDeps, 'send')
}

function wireResponse(response: Response) {
  return {
    response,
    destroy: async () => {},
  }
}

describe('newznab', () => {
  it('checks declared capabilities and tests authentication with a nonempty search', async () => {
    const send = mockedTransport()
      .mockResolvedValueOnce(wireResponse(new Response(caps)))
      .mockResolvedValueOnce(
        wireResponse(
          new Response('<rss><channel><title>Fixture</title></channel></rss>'),
        ),
      )
    await expect(checkNewznab(source)).resolves.toMatchObject({
      movieSearch: { params: ['q', 'imdbid'] },
    })
    expect(send.mock.calls[0]?.[0].pathname).toBe('/base/5/api')
    expect(send.mock.calls[0]?.[0].searchParams.get('apikey')).toBe(
      'fixture-key',
    )
    expect(send.mock.calls[1]?.[0].searchParams.get('q')).toBeTruthy()
    expect(send.mock.calls[1]?.[0].searchParams.get('limit')).toBe('1')
  })

  it('honors an identifier-only capability when verifying credentials', async () => {
    const xml
      = '<caps><searching><movie-search available="yes" supportedParams="imdbid"/></searching></caps>'
    const send = mockedTransport()
      .mockResolvedValueOnce(wireResponse(new Response(xml)))
      .mockResolvedValueOnce(
        wireResponse(
          new Response('<rss><channel><title>Fixture</title></channel></rss>'),
        ),
      )
    await expect(checkNewznab(source)).resolves.toMatchObject({
      movieSearch: { params: ['imdbid'] },
    })
    const params = send.mock.calls[1]![0].searchParams
    expect(params.has('q')).toBe(false)
    expect(params.get('imdbid')).toBe('999999999')
  })

  it('recognizes an XML authentication error and HTTP quota', async () => {
    mockedTransport()
      .mockResolvedValueOnce(
        wireResponse(new Response('<error code="100" description="fixture"/>')),
      )
      .mockResolvedValueOnce(
        wireResponse(
          new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
        ),
      )
    await expect(checkNewznab(source)).rejects.toMatchObject({ kind: 'auth' })
    await expect(checkNewznab(source)).rejects.toMatchObject({
      kind: 'remote',
      retryAt: expect.any(Date),
    })
  })

  it('uses the enclosure and GUID without exposing a torrent-shaped release', async () => {
    mockedTransport().mockResolvedValueOnce(
      wireResponse(
        new Response(`<rss xmlns:newznab="https://newznab.example"><channel><newznab:response offset="0" total="3"/>
      <item><title>Fixture.2026.1080p</title><guid isPermaLink="false">fixture-1</guid>
      <link>https://manager.example/not-the-download</link>
      <enclosure url="/base/5/download?opaque=fixture" type="application/x-nzb" length="12345"/></item>
      <item><title>Wrong protocol</title><guid>fixture-2</guid>
      <enclosure url="/base/5/download" type="application/x-bittorrent"/></item>
    </channel></rss>`),
      ),
    )
    await expect(
      fetchNewznabPage(source, { t: 'search', q: 'Fixture' }),
    ).resolves.toEqual({
      releases: [
        {
          title: 'Fixture.2026.1080p',
          guid: 'fixture-1',
          download: '/base/5/download?opaque=fixture',
          size: 12345,
        },
      ],
      nextOffset: 2,
    })
  })

  it('stops a Prowlarr redirect before connecting without source-specific approval', async () => {
    const send = mockedTransport().mockResolvedValueOnce(
      wireResponse(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://upstream.example/nzb?own=fixture' },
        }),
      ),
    )
    await expect(
      fetchNzb(source, '/base/5/download?apikey=fixture-key'),
    ).rejects.toMatchObject({ kind: 'bad_response' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('follows an approved Prowlarr redirect without forwarding the manager key', async () => {
    const send = mockedTransport()
      .mockResolvedValueOnce(
        wireResponse(
          new Response(null, {
            status: 302,
            headers: { Location: 'https://upstream.example/nzb?own=fixture' },
          }),
        ),
      )
      .mockResolvedValueOnce(wireResponse(new Response(nzb)))
    const received = await fetchNzb(
      {
        ...source,
        downloadOrigins: [
          { origin: 'https://upstream.example', lanAddresses: [] },
        ],
      },
      '/base/5/download?apikey=fixture-key',
    )
    expect(new TextDecoder().decode(received)).not.toContain('DOCTYPE')
    expect(send.mock.calls[1]?.[0].href).toBe(
      'https://upstream.example/nzb?own=fixture',
    )
    expect([...send.mock.calls[1]![2].headers]).toEqual([])
  })

  it('rejects a changed LAN address before sending the request', async () => {
    const send = mockedTransport()
    vi.mocked(netResolveDeps.routeAddresses).mockResolvedValue([
      '192.168.20.12',
    ])
    await expect(
      fetchNzb(
        {
          url: 'http://manager.example/base/5',
          lanAddresses: ['192.168.20.11'],
        },
        '/base/5/download',
      ),
    ).rejects.toMatchObject({ message: 'address_changed' })
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects unrecognized declarations, entity expansion and HTML', () => {
    for (const input of [
      '<!DOCTYPE nzb SYSTEM "https://bad.example/dtd"><nzb><file/></nzb>',
      '<!DOCTYPE nzb [<!ENTITY x "fixture">]><nzb><file>&x;</file></nzb>',
      '<html><file/></html>',
    ]) {
      expect(() => validatedNzb(new TextEncoder().encode(input))).toThrow(
        'valid NZB',
      )
    }
  })
})
