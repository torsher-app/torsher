import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseRelease } from '@torsher/release-parser'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  followEpisodes,
  follows,
  serverSettings,
  users,
} from '../db/schema.ts'
import {
  DEFAULT_PROFILE,
  saveSourceProfile,
  sourceProfile,
  sourceSettings,
} from '../services/sources/profile.ts'
import { rankReleases } from '../services/sources/rank.ts'
import {
  followAudio,
  followSourceProfile,
  setServerAudio,
} from '../services/follow/audio.ts'
import { setSetting } from '../services/settings/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const cookies = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const url = '/api/settings/sources'
const qualities = ['2160p', '1080p', '720p', 'SD']
const presetUrl = `${url}/presets/default-1080p`

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'hash' })
    .run()
})
beforeEach(() => {
  getDb().delete(follows).run()
  getDb().delete(serverSettings).run()
})
afterAll(() => app.close())

describe('source preferences', () => {
  it('keeps explicit preset languages strict while preserving explicit follow overrides', () => {
    saveSourceProfile({ audioLanguages: ['de', 'ru'] })
    expect(
      followSourceProfile({ audio: null, requireRussian: false })
        .audioLanguages,
    ).toEqual(['de', 'ru'])
    expect(
      followSourceProfile({ audio: 'ru', requireRussian: false })
        .audioLanguages,
    ).toEqual(['ru', 'original'])
    expect(
      followSourceProfile({ audio: 'de', requireRussian: true }).audioLanguages,
    ).toEqual(['de', 'original'])
  })

  it('starts with original and writes legacy language updates to the default preset', () => {
    expect(
      sourceSettings().presets.every(
        preset =>
          preset.audioLanguages.join(',') === 'original'
          && preset.voiceTypes.length === 6,
      ),
    ).toBe(true)
    expect(followAudio({ audio: null })).toBe('original')
    setServerAudio({ value: 'de', source: 'user' })
    expect(sourceProfile().audioLanguages).toEqual(['de', 'original'])
    expect(followAudio({ audio: null })).toBe('de')
  })

  it('preserves existing server language and legacy preset orders', () => {
    setSetting('follow', { audio: { value: 'ja', source: 'user' } })
    expect(sourceProfile().audioLanguages).toEqual(['ja', 'original'])
    expect(followAudio({ audio: null })).toBe('ja')
    setSetting('sources.profile', {
      defaultPresetId: 'legacy',
      presets: [
        {
          id: 'legacy',
          name: 'Legacy',
          qualities,
          voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'L'],
        },
      ],
    })
    expect(sourceProfile()).toMatchObject({
      audioLanguages: ['ja', 'original'],
      qualities,
      voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'L'],
    })
    saveSourceProfile({ audioLanguages: ['de'] })
    expect(followAudio({ audio: null })).toBe('de')
    expect(followAudio({ audio: 'ru' })).toBe('ru')
  })

  it('invalidates only follows whose effective audio changes', () => {
    const firstSeenAt = new Date('2026-01-01T00:00:00Z')
    const pending = {
      id: 'release',
      title: 'Lantern.S01E01.1080p',
      seeders: 1,
    }
    for (const audio of [null, 'ja'] as const) {
      const follow = getDb()
        .insert(follows)
        .values({
          titleId: `tmdb:tv:${audio ?? 'default'}`,
          state: 'active',
          kind: 'series',
          startSeason: 1,
          startEpisode: 1,
          requireRussian: false,
          waitHours: 24,
          audio,
        })
        .returning()
        .get()
      getDb()
        .insert(followEpisodes)
        .values({
          followId: follow.id,
          season: 1,
          episode: 1,
          pending,
          firstSeenAt,
        })
        .run()
    }
    saveSourceProfile({ audioLanguages: ['de'] })
    const rows = getDb().select().from(followEpisodes).all()
    expect(rows[0]).toMatchObject({ pending: null, firstSeenAt })
    expect(rows[1]).toMatchObject({ pending, firstSeenAt })
    getDb().update(followEpisodes).set({ pending }).run()
    setServerAudio({ value: 'ru', source: 'user' })
    expect(getDb().select().from(followEpisodes).all()[0]?.pending).toBeNull()
    expect(
      getDb().select().from(followEpisodes).all()[1]?.pending,
    ).toBeTruthy()
  })

  it('supports CRUD with stable IDs and protects the default preset', async () => {
    const result = await app.inject({
      method: 'POST',
      url: `${url}/presets`,
      cookies,
      payload: { name: 'Bedroom' },
    })
    expect(result.statusCode).toBe(200)
    const created = result.json().presets[2]
    expect(created.id).toBeTruthy()
    const path = `${url}/presets/${created.id}`
    const renamed = await app.inject({
      method: 'PATCH',
      url: path,
      cookies,
      payload: {
        name: 'Small screen',
        qualities: ['720p', '1080p', '2160p', 'SD'],
      },
    })
    expect(renamed.json().presets[2]).toMatchObject({
      id: created.id,
      name: 'Small screen',
      qualities: ['720p', '1080p', '2160p', 'SD'],
    })
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          cookies,
          payload: { defaultPresetId: created.id },
        })
      ).statusCode,
    ).toBe(200)
    expect(sourceProfile().qualities[0]).toBe('720p')
    expect(
      (await app.inject({ method: 'DELETE', url: path, cookies })).statusCode,
    ).toBe(409)
    await app.inject({
      method: 'PUT',
      url,
      cookies,
      payload: { defaultPresetId: 'default-1080p' },
    })
    expect(
      (await app.inject({ method: 'DELETE', url: path, cookies })).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: path,
          cookies,
          payload: { name: 'Gone' },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          cookies,
          payload: { defaultPresetId: 'missing' },
        })
      ).statusCode,
    ).toBe(404)
  })

  it('atomically edits and selects a default, invalidating only its final effective order', async () => {
    const firstSeenAt = new Date('2026-01-01T00:00:00Z')
    const pending = { id: 'release', title: 'Lantern.S01E01.720p', seeders: 1 }
    const follow = getDb()
      .insert(follows)
      .values({
        titleId: 'tmdb:tv:atomic',
        state: 'active',
        requireRussian: true,
        waitHours: 24,
        kind: 'series',
        startSeason: 1,
        startEpisode: 1,
        lastSearchAt: firstSeenAt,
      })
      .returning()
      .get()
    getDb()
      .insert(followEpisodes)
      .values({
        followId: follow.id,
        season: 1,
        episode: 1,
        firstSeenAt,
        pending,
      })
      .run()
    const path = `${url}/presets/default-4k`
    // The intermediate 4K order would invalidate pending; the final order is
    // identical to the current default, so an atomic update must preserve it.
    const unchanged = await app.inject({
      method: 'PATCH',
      url: path,
      cookies,
      payload: { ...DEFAULT_PROFILE, makeDefault: true },
    })
    expect(unchanged.statusCode).toBe(200)
    expect(unchanged.json().defaultPresetId).toBe('default-4k')
    expect(getDb().select().from(followEpisodes).get()!.pending).toEqual(
      pending,
    )
    expect(sourceSettings().presets[1]).not.toHaveProperty('makeDefault')
    const payload = {
      qualities,
      voiceTypes: ['MVO', 'D', 'DVO', 'AVO', 'VO', 'L'],
      makeDefault: true,
    }
    expect(
      (await app.inject({ method: 'PATCH', url: path, cookies, payload }))
        .statusCode,
    ).toBe(200)
    expect(sourceProfile()).toEqual({
      qualities,
      audioLanguages: ['original'],
      voiceTypes: payload.voiceTypes,
    })
    expect(getDb().select().from(followEpisodes).get()).toMatchObject({
      pending: null,
      firstSeenAt,
    })
    // A repeated save is a no-op, including work selected since the first save.
    getDb().update(followEpisodes).set({ pending }).run()
    await app.inject({ method: 'PATCH', url: path, cookies, payload })
    expect(getDb().select().from(followEpisodes).get()!.pending).toEqual(
      pending,
    )
    const invalid = await app.inject({
      method: 'PATCH',
      url: presetUrl,
      cookies,
      payload: { qualities: [], makeDefault: true },
    })
    expect(invalid.statusCode).toBe(400)
    expect(sourceSettings().defaultPresetId).toBe('default-4k')
  })

  it('preserves a stored legacy single profile, including its ranking order', async () => {
    setSetting('sources.profile', {
      qualities: ['720p', '1080p', '2160p'],
      voiceTypes: ['MVO', 'D', 'DVO', 'AVO', 'VO', 'L'],
    })
    expect(sourceSettings().presets[0]).toMatchObject({
      qualities: ['720p', '1080p', '2160p', 'SD'],
      voiceTypes: ['MVO', 'D', 'DVO', 'AVO', 'VO', 'L'],
    })
    await app.inject({
      method: 'POST',
      url: `${url}/presets`,
      cookies,
      payload: { name: 'Copy' },
    })
    expect(sourceProfile().qualities).toEqual(['720p', '1080p', '2160p', 'SD'])
  })

  it('returns defaults and persists independent quality and voice updates', async () => {
    expect((await app.inject({ url, cookies })).json()).toEqual(
      sourceSettings(),
    )
    const voices = ['L', 'VO', 'AVO', 'DVO', 'MVO', 'D']
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: presetUrl,
          cookies,
          payload: { qualities },
        })
      ).statusCode,
    ).toBe(200)
    const saved = await app.inject({
      method: 'PATCH',
      url: presetUrl,
      cookies,
      payload: { voiceTypes: voices },
    })
    expect(sourceProfile()).toEqual({
      qualities,
      voiceTypes: voices,
      audioLanguages: ['original'],
    })
    expect(saved.json().presets[0]).toMatchObject(sourceProfile())
    expect((await app.inject({ url, cookies })).json()).toEqual(saved.json())
  })

  it.each([
    { audioLanguages: [] },
    { audioLanguages: ['de', 'de'] },
    { audioLanguages: ['xx'] },
    { qualities: [] },
    { qualities: ['1080p', '2160p', '720p'] },
    { qualities: ['1080p', '1080p', '720p', 'SD'] },
    { qualities: ['1080p', '2160p', '720p', '8K'] },
    { voiceTypes: ['D'] },
    { voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'Original'] },
    { voiceTypes: ['D', 'MVO', 'DVO', 'AVO', 'VO', 'VO'] },
  ])('rejects incomplete or repeated orders: %j', async (payload) => {
    expect(
      (await app.inject({ method: 'PATCH', url: presetUrl, cookies, payload }))
        .statusCode,
    ).toBe(400)
    expect(sourceProfile()).toEqual(DEFAULT_PROFILE)
  })

  it('requires an owner session to read or change preferences', async () => {
    for (const auth of [{}, { [DEVICE_TOKEN_COOKIE]: 'device-token' }]) {
      expect((await app.inject({ url, cookies: auth })).statusCode).toBe(401)
      expect(
        (
          await app.inject({
            method: 'PUT',
            url,
            cookies: auth,
            payload: { qualities },
          })
        ).statusCode,
      ).toBe(401)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `${url}/presets`,
            cookies: auth,
            payload: { name: 'Blocked' },
          })
        ).statusCode,
      ).toBe(401)
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: presetUrl,
            cookies: auth,
            payload: { qualities },
          })
        ).statusCode,
      ).toBe(401)
      expect(
        (await app.inject({ method: 'DELETE', url: presetUrl, cookies: auth }))
          .statusCode,
      ).toBe(401)
    }
  })

  it('changes the actual recommendation while preserving default ranking', async () => {
    const releases = ['1080p', '2160p', '720p', 'SD'].map((quality, index) => ({
      id: quality,
      title: `Lantern.2024.WEB-DL.${quality}`,
      indexers: [],
      seeders: 40,
      parsed: parseRelease(`Lantern.2024.WEB-DL.${quality}`),
      match: { confidence: 'high' as const, issues: [] },
      size: [8, 20, 4, 1][index]! * 1024 ** 3,
    }))
    const ctx = {
      kind: 'movie' as const,
      audio: 'original' as const,
      profile: sourceProfile(),
    }
    expect(rankReleases(releases, ctx).top[0]).toBe('1080p')
    const previous = {
      ...ctx,
      profile: {
        ...DEFAULT_PROFILE,
        qualities: DEFAULT_PROFILE.qualities.slice(0, 3),
      },
    }
    expect(rankReleases(releases, ctx).ranked).toEqual(
      rankReleases(releases, previous).ranked,
    )
    await app.inject({
      method: 'PATCH',
      url: presetUrl,
      cookies,
      payload: { qualities },
    })
    expect(
      rankReleases(releases, { ...ctx, profile: sourceProfile() }).top[0],
    ).toBe('2160p')
  })

  it('invalidates unfinished pending choices, preserves their window and does nothing for a no-op', async () => {
    const firstSeenAt = new Date('2026-01-01T00:00:00Z')
    const waitUntil = new Date('2026-01-02T00:00:00Z')
    const pending = { id: 'release', title: 'Lantern.S01E01.720p', seeders: 1 }
    for (const state of ['active', 'paused', 'stopped', 'done'] as const) {
      const follow = getDb()
        .insert(follows)
        .values({
          titleId: `tmdb:tv:${state}`,
          kind: 'series',
          startSeason: 1,
          startEpisode: 1,
          requireRussian: true,
          waitHours: 24,
          state,
          lastSearchAt: firstSeenAt,
          nextSearchAt: waitUntil,
        })
        .returning()
        .get()
      getDb()
        .insert(followEpisodes)
        .values({
          followId: follow.id,
          season: 1,
          episode: 1,
          firstSeenAt,
          waitUntil,
          pending,
        })
        .run()
    }
    const active = getDb()
      .select()
      .from(follows)
      .where(eq(follows.state, 'active'))
      .get()!
    getDb()
      .insert(followEpisodes)
      .values({
        followId: active.id,
        season: 1,
        episode: 2,
        firstSeenAt,
        picked: pending,
        pickedAt: firstSeenAt,
      })
      .run()
    await app.inject({
      method: 'PATCH',
      url: presetUrl,
      cookies,
      payload: DEFAULT_PROFILE,
    })
    expect(
      getDb()
        .select()
        .from(followEpisodes)
        .all()
        .filter(row => row.pending),
    ).toHaveLength(4)
    const clone = (
      await app.inject({
        method: 'POST',
        url: `${url}/presets`,
        cookies,
        payload: { name: 'Same order' },
      })
    ).json().presets[2]
    await app.inject({
      method: 'PUT',
      url,
      cookies,
      payload: { defaultPresetId: clone.id },
    })
    expect(
      getDb()
        .select()
        .from(followEpisodes)
        .all()
        .filter(row => row.pending),
    ).toHaveLength(4)
    await app.inject({
      method: 'PUT',
      url,
      cookies,
      payload: { defaultPresetId: 'default-1080p' },
    })
    await app.inject({
      method: 'PATCH',
      url: presetUrl,
      cookies,
      payload: { name: 'Renamed' },
    })
    await app.inject({
      method: 'PATCH',
      url: `${url}/presets/default-4k`,
      cookies,
      payload: { qualities: ['SD', '720p', '1080p', '2160p'] },
    })
    expect(
      getDb()
        .select()
        .from(followEpisodes)
        .all()
        .filter(row => row.pending),
    ).toHaveLength(4)
    await app.inject({
      method: 'PATCH',
      url: presetUrl,
      cookies,
      payload: { qualities },
    })
    for (const follow of getDb().select().from(follows).all()) {
      const row = getDb()
        .select()
        .from(followEpisodes)
        .where(eq(followEpisodes.followId, follow.id))
        .get()!
      expect(row.firstSeenAt).toEqual(firstSeenAt)
      expect(row.pending).toEqual(follow.state === 'done' ? pending : null)
      expect(row.waitUntil).toEqual(follow.state === 'done' ? waitUntil : null)
      expect(follow.nextSearchAt).toEqual(
        follow.state === 'done' ? waitUntil : null,
      )
      expect(follow.lastSearchAt).toEqual(
        follow.state === 'done' ? firstSeenAt : null,
      )
    }
    expect(
      getDb()
        .select()
        .from(followEpisodes)
        .where(eq(followEpisodes.episode, 2))
        .get()
        ?.picked,
    ).toEqual(pending)
  })
})
