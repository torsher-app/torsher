import type { Listing } from './blocklist.ts'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { releaseBlocklist } from '../../db/schema.ts'
import {
  blockedPart,
  blockedReleases,
  blockRelease,
  rememberListing,
} from './blocklist.ts'

const SERIES = 'tmdb:tv:3200'
const OTHER = 'tmdb:tv:3201'
const HASH = 'd'.repeat(40)
const GB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000
const TITLE
  = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 12 (2024) WEB-DL 1080p | LostFilm'

/** Раздача без infohash, как её показал один индексатор */
function shown(listing: Listing) {
  return {
    title: listing.title,
    size: listing.size,
    indexers: [{ id: listing.indexerId, detailsUrl: listing.page }],
  }
}

function part(titleId: string, listing: Listing) {
  return blockedPart(shown(listing), blockedReleases(titleId))
}

function rows() {
  return getDb().select().from(releaseBlocklist).all()
}

beforeAll(async () => {
  await migrateDb()
})

beforeEach(() => {
  getDb().delete(releaseBlocklist).run()
})

describe('чёрный список: раздачи без infohash', () => {
  it('раздачу у двух индексаторов узнают по обоим показам', () => {
    const a: Listing = {
      indexerId: 'ix-a',
      page: 'https://a.tracker.example/topic/1',
      title: TITLE,
      size: 12 * GB,
    }
    const b: Listing = {
      indexerId: 'ix-b',
      page: 'https://b.tracker.example/view/77',
      title: 'Quiet.Harbor.S02E01-08.1080p.WEB-DL',
      size: 12 * GB,
    }

    blockRelease({
      titleId: SERIES,
      infoHash: HASH,
      releaseTitle: 'Quiet.Harbor.S02.1080p',
      reason: 'failed_check',
    })
    rememberListing(HASH, a)
    rememberListing(HASH, b)
    rememberListing(HASH, a)

    expect(part(SERIES, a)).toBeNull()
    expect(part(SERIES, b)).toBeNull()
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.listings).toHaveLength(2)
  })

  it('перезалив с тем же названием и другим размером не наследует запрет', () => {
    const old: Listing = {
      indexerId: 'ix-a',
      page: 'https://a.tracker.example/topic/1',
      title: TITLE,
      size: 12 * GB,
    }

    blockRelease({
      titleId: SERIES,
      infoHash: HASH,
      releaseTitle: 'Quiet.Harbor.S02.1080p',
      reason: 'failed_check',
      listings: [old],
    })

    expect(part(SERIES, old)).toBeNull()
    expect(part(SERIES, { ...old, size: 12.4 * GB })).toBeUndefined()
  })

  it('показ без страницы узнаётся только у своего индексатора и тайтла', () => {
    const listing: Listing = { indexerId: 'ix-a', title: TITLE, size: 12 * GB }

    blockRelease({
      titleId: SERIES,
      releaseTitle: TITLE,
      reason: 'user',
      listings: [listing],
    })

    expect(part(SERIES, listing)).toBeNull()
    expect(part(SERIES, { ...listing, indexerId: 'ix-b' })).toBeUndefined()
    expect(part(OTHER, listing)).toBeUndefined()
  })
})

describe('чёрный список: одна запись на раздачу и причину', () => {
  it('серии, срок и показы сливаются; вся раздача сильнее списка серий', () => {
    const now = new Date()
    const later = new Date(now.getTime() + 3 * DAY_MS)
    const base = {
      titleId: SERIES,
      infoHash: HASH.toUpperCase(),
      releaseTitle: 'Quiet.Harbor.S02.1080p',
    }

    blockRelease({ ...base, reason: 'failed_check', episodes: ['2:7'] }, now)
    blockRelease({ ...base, reason: 'failed_check', episodes: ['2:8'] }, now)

    expect(rows()).toEqual([
      expect.objectContaining({ episodes: ['2:7', '2:8'], expiresAt: null }),
    ])

    blockRelease({ ...base, reason: 'failed_check' }, now)
    blockRelease({ ...base, reason: 'failed_check', episodes: ['2:9'] }, now)

    expect(rows()).toEqual([expect.objectContaining({ episodes: null })])

    blockRelease({ ...base, reason: 'stalled', episodes: ['2:1'] }, later)
    blockRelease({ ...base, reason: 'stalled', episodes: ['2:2'] }, now)

    const stalled = rows().filter(row => row.reason === 'stalled')

    expect(stalled).toEqual([
      expect.objectContaining({
        episodes: ['2:1', '2:2'],
        createdAt: later,
        expiresAt: new Date(later.getTime() + 7 * DAY_MS),
      }),
    ])

    blockRelease({ ...base, reason: 'user' }, now)
    blockRelease({ ...base, reason: 'user' }, now)

    expect(
      rows()
        .map(row => row.reason)
        .sort(),
    ).toEqual(['failed_check', 'stalled', 'user'])
  })

  it('запрет без infohash — одна запись на общий показ', () => {
    const listing: Listing = {
      indexerId: 'ix-a',
      page: 'https://a.tracker.example/topic/1',
      title: TITLE,
      size: 12 * GB,
    }
    const entry = {
      titleId: SERIES,
      releaseTitle: TITLE,
      reason: 'user' as const,
    }

    blockRelease({ ...entry, listings: [listing] })
    blockRelease({
      ...entry,
      listings: [listing, { ...listing, indexerId: 'ix-b', page: undefined }],
    })

    expect(rows()).toEqual([
      expect.objectContaining({ infoHash: null, episodes: null }),
    ])
    expect(rows()[0]!.listings).toHaveLength(2)
  })
})
