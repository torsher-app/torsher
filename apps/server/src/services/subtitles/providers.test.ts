import { afterEach, expect, it, vi } from 'vitest'
import { setNetTransport } from '../net/index.ts'
import { migrateDb } from '../../db/index.ts'
import { deleteSetting } from '../settings/index.ts'
import { testSubtitleConnection } from './providers.ts'
import { SUBTITLE_SETTINGS_KEY, updateSubtitleConfig } from './settings.ts'
import {
  checkOpenSubtitles,
  clearOpenSubtitlesLogin,
  downloadOpenSubtitles,
  searchOpenSubtitles,
} from './opensubtitles.ts'
import { checkSubdl, downloadSubdl, searchSubdl } from './subdl.ts'

const credentials = {
  revision: 'fixture',
  apiKey: 'key',
  username: 'user',
  password: 'pass',
}
const signal = new AbortController().signal
const movie = {
  type: 'movie' as const,
  tmdbId: 682,
  release: 'Synthetic.1080p.WEB-DL.mkv',
}
const episode = {
  type: 'tv' as const,
  tmdbId: 852,
  season: 2,
  episode: 5,
  release: 'Synthetic.S02E05.1080p.WEB-DL.mkv',
}
const text = '1\n00:00:01,000 --> 00:00:03,000\nExample\n'

afterEach(() => {
  setNetTransport(null)
  clearOpenSubtitlesLogin()
})

it('checks OpenSubtitles without spending a download, keeps credentials on API hosts and rejects unknown redirects', async () => {
  const requests: string[] = []
  const fixture = vi.fn(async (address: string, options: RequestInit) => {
    const url = new URL(address)
    const headers = new Headers(options.headers)
    requests.push(url.pathname)
    if (url.pathname === '/api/v1/login') {
      expect(url.origin).toBe('https://api.opensubtitles.com')
      expect(headers.get('api-key')).toBe('key')
      expect(JSON.parse(String(options.body))).toEqual({
        username: 'user',
        password: 'pass',
      })
      return Response.json({
        token: 'session',
        base_url: 'vip-api.opensubtitles.com',
      })
    }
    if (url.pathname === '/file.srt') {
      expect(url.origin).toBe('https://www.opensubtitles.com')
      expect(headers.get('api-key')).toBeNull()
      expect(headers.get('authorization')).toBeNull()
      return new Response(null, {
        status: 302,
        headers: { location: 'https://unrelated.example/test.srt' },
      })
    }

    expect(url.origin).toBe('https://vip-api.opensubtitles.com')
    expect(headers.get('api-key')).toBe('key')
    expect(headers.get('authorization')).toBe('Bearer session')
    if (url.pathname === '/api/v1/infos/user')
      return Response.json({ data: { remaining_downloads: 8 } })
    if (url.pathname === '/api/v1/download') {
      expect(JSON.parse(String(options.body))).toMatchObject({
        file_id: 112,
        sub_format: 'srt',
      })
      return Response.json({
        link: 'https://www.opensubtitles.com/file.srt',
        remaining: 7,
        reset_time_utc: '2026-11-25T00:00:00Z',
      })
    }
    expect(url.searchParams.get('tmdb_id')).toBe('682')
    expect(url.searchParams.get('moviehash')).toBe('aabbccdd00112233')
    return Response.json({
      data: [
        {
          attributes: {
            language: 'en',
            release: 'Synthetic.1080p.WEB-DL',
            moviehash_match: true,
            feature_details: { tmdb_id: 682 },
            files: [{ file_id: 112 }],
          },
        },
        {
          attributes: {
            language: 'en',
            release: 'Different video',
            moviehash_match: true,
            feature_details: { tmdb_id: 683 },
            files: [{ file_id: 113 }],
          },
        },
      ],
    })
  })
  setNetTransport(fixture)
  expect(await checkOpenSubtitles(credentials, signal)).toEqual({
    kind: 'ready',
    remainingDownloads: 8,
  })
  expect(requests).toEqual(['/api/v1/login', '/api/v1/infos/user'])
  const [match, ...extra] = await searchOpenSubtitles(
    credentials,
    movie,
    'en',
    signal,
    'aabbccdd00112233',
  )
  expect(extra).toEqual([])
  expect(match).toMatchObject({ remoteId: '112', match: 'hash' })
  const quota = vi.fn()
  await expect(
    downloadOpenSubtitles(credentials, match!, signal, quota),
  ).rejects.toMatchObject({ kind: 'unavailable' })
  expect(quota).toHaveBeenCalledWith({
    kind: 'ready',
    remainingDownloads: 7,
    resetAt: '2026-11-25T00:00:00.000Z',
  })
  expect(requests.at(-1)).toBe('/file.srt')
})

it('checks SubDL quotas and chooses an individual SRT with the exact episode from a pack', async () => {
  setNetTransport(async (address, options) => {
    const url = new URL(address)
    const authorization = new Headers(options.headers).get('authorization')
    if (url.origin === 'https://dl.subdl.com') {
      expect(url.pathname).toBe('/subtitle/abc/right')
      expect(authorization).toBeNull()
      expect(new Headers(options.headers).get('x-api-key')).toBe('key')
      return new Response(text)
    }
    expect(url.origin).toBe('https://api.subdl.com')
    expect(authorization).toBe('Bearer key')
    if (url.pathname === '/api/v2/me') {
      return Response.json({
        usage: { search: { remaining: 22 }, downloads: { remaining: 12 } },
      })
    }
    expect(url.searchParams.get('season')).toBe('2')
    expect(url.searchParams.get('episode')).toBe('5')
    return Response.json({
      results: [{ tmdb_id: 852, type: 'tv' }],
      subtitles: [
        {
          n_id: 'abc',
          unpack_files: [
            {
              file_n_id: 'wrong',
              name: 'episode4.srt',
              language: 'EN',
              season: 2,
              episode: 4,
              url: '/subtitle/abc/wrong',
            },
            {
              file_n_id: 'right',
              name: 'episode5.srt',
              language: 'EN',
              season: 2,
              episode: 5,
              url: '/subtitle/abc/right',
            },
            {
              file_n_id: 'another',
              name: 'episode5.ass',
              language: 'EN',
              season: 2,
              episode: 5,
              url: '/subtitle/abc/another',
            },
          ],
        },
      ],
    })
  })
  expect(await checkSubdl(credentials, signal)).toMatchObject({
    kind: 'ready',
    remainingSearches: 22,
    remainingDownloads: 12,
  })
  const items = await searchSubdl(credentials, episode, 'en', signal)
  expect(items.map(item => item.remoteId)).toEqual(['abc:right'])
  expect((await downloadSubdl(credentials, items[0]!, signal)).toString()).toBe(
    text,
  )
})

it('returns the same safe status for two reused failing provider checks', async () => {
  await migrateDb()
  updateSubtitleConfig({ subdl: { apiKey: 'synthetic' } })
  const failed = vi.fn(async () => new Response(null, { status: 503 }))
  setNetTransport(failed)
  try {
    expect(await testSubtitleConnection('subdl')).toMatchObject({
      kind: 'unavailable',
    })
    expect(await testSubtitleConnection('subdl')).toMatchObject({
      kind: 'unavailable',
    })
    expect(failed).toHaveBeenCalledTimes(1)
  }
  finally {
    deleteSetting(SUBTITLE_SETTINGS_KEY)
  }
})
