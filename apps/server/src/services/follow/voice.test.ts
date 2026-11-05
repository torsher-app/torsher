import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  followEpisodes,
  follows,
  serverSettings,
  titleVoices,
} from '../../db/schema.ts'
import { saveSourceProfile } from '../sources/profile.ts'
import { pinVoice } from '../sources/voices.ts'
import {
  permitsCandidate,
  resolveVoice,
  seasonVoice,
  voiceGuard,
} from './voice.ts'
import { updateFollow } from './index.ts'
import { normalizeRules } from './rules.ts'
import { positionOf } from './decide.ts'
import { isUpgrade, versionOf } from './upgrade.ts'
import { followSourceProfile } from './audio.ts'

beforeAll(async () => {
  await migrateDb()
})
beforeEach(() => {
  getDb().delete(follows).run()
  getDb().delete(titleVoices).run()
  getDb().delete(serverSettings).run()
  saveSourceProfile({ audioLanguages: ['ru'], voiceTypes: ['D', 'MVO'] })
})
function follow() {
  return getDb()
    .insert(follows)
    .values({
      titleId: 'tmdb:tv:3000',
      kind: 'series',
      state: 'active',
      startSeason: 2,
      startEpisode: 1,
      requireRussian: true,
      waitHours: 24,
    })
    .returning()
    .get()
}

describe('explicit follow voice policy', () => {
  it('preserves legacy pins and gives explicit choices priority across seasons', () => {
    const row = follow()
    pinVoice(row.titleId, 2, { studio: 'LostFilm' })
    expect(seasonVoice(row, 3)?.studio).toBe('LostFilm')
    expect(resolveVoice(row, 3)).toMatchObject({
      source: 'inherited_pin',
      sourceSeason: 2,
    })
    for (const mode of ['prefer', 'only'] as const) {
      const saved = updateFollow(row.id, {
        rules: { voicePolicy: { mode, studio: 'NewStudio' } },
      })!
      expect(seasonVoice(saved, 2)?.studio).toBe('NewStudio')
      expect(seasonVoice(saved, 3)?.studio).toBe('NewStudio')
    }
    const any = updateFollow(row.id, {
      rules: { voicePolicy: { mode: 'any' } },
    })!
    expect(seasonVoice(any, 2)).toBeUndefined()
    expect(getDb().select().from(titleVoices).all()).toHaveLength(1)
    const auto = updateFollow(row.id, {
      rules: { voicePolicy: { mode: 'auto' } },
    })!
    expect(seasonVoice(auto, 3)?.studio).toBe('LostFilm')
    expect(resolveVoice({ ...auto, audio: 'de' }, 3)).toMatchObject({
      active: false,
      source: 'none',
    })
  })

  it('keeps modern mode for unchanged old full forms and rejects contradictory contracts', () => {
    const row = { ...follow(), voiceMode: 'auto' as const }
    expect(
      normalizeRules(
        { voiceStudio: null, voiceStrict: false, waitHours: 12 },
        row,
      ).voiceMode,
    ).toBeUndefined()
    expect(normalizeRules({ voiceStudio: 'NewStudio' }, row)).toMatchObject({
      voiceMode: 'prefer',
    })
    expect(() =>
      normalizeRules(
        { voicePolicy: { mode: 'any' }, voiceStudio: 'LostFilm' },
        row,
      ),
    ).toThrow()
  })

  it('reparses multi-audio saved candidates rather than using old selected studio', () => {
    const row = {
      ...follow(),
      voiceMode: 'only' as const,
      voiceStudio: 'NewStudio',
      voiceStrict: true,
    }
    expect(
      permitsCandidate(
        row,
        {
          id: 'multi',
          title: 'Quiet Harbor S02E01 1080p | LostFilm, NewStudio',
          studio: 'LostFilm',
          seeders: 5,
        },
        2,
      ),
    ).toBe(true)
    expect(
      permitsCandidate(
        row,
        {
          id: 'single',
          title: 'Quiet Harbor S02E01 1080p | LostFilm',
          studio: 'LostFilm',
          seeders: 5,
        },
        2,
      ),
    ).toBe(false)
  })

  it('any does not wait for or upgrade only translation type', () => {
    const row = { ...follow(), voiceMode: 'any' as const }
    const profile = followSourceProfile(row)
    const rank = { kind: row.kind, profile }
    const ctx = {
      profile,
      preset: row.qualityPreset,
      russianOriginal: false,
      voiceMode: row.voiceMode,
    }
    const season = { season: 2, cutoffStep: 0 }
    const dub = positionOf(
      versionOf({ title: 'Quiet Harbor S02E01 1080p DUB' }, rank),
      season,
      ctx,
    )
    const mvo = positionOf(
      versionOf({ title: 'Quiet Harbor S02E01 1080p MVO' }, rank),
      season,
      ctx,
    )
    expect(mvo.voiceAtCutoff).toBe(true)
    expect(isUpgrade(dub, mvo)).toBe(false)
  })

  it('invalidates pending without restarting first seen and guard sees pin changes', () => {
    const row = follow()
    const firstSeenAt = new Date(Date.now() - 3_600_000)
    getDb()
      .insert(followEpisodes)
      .values({
        followId: row.id,
        season: 2,
        episode: 1,
        firstSeenAt,
        waitUntil: new Date(),
        pending: {
          id: 'one',
          title: 'Quiet Harbor S02E01 1080p LostFilm',
          seeders: 2,
        },
      })
      .run()
    const guard = voiceGuard(row, [2])
    pinVoice(row.titleId, 2, { studio: 'NewStudio' })
    expect(guard()).toBe(false)
    updateFollow(row.id, {
      rules: { voicePolicy: { mode: 'only', studio: 'NewStudio' } },
    })
    const episode = getDb()
      .select()
      .from(followEpisodes)
      .where(eq(followEpisodes.followId, row.id))
      .get()!
    expect(episode.pending).toBeNull()
    expect(episode.firstSeenAt).toEqual(firstSeenAt)
  })
})

it('normalizes modern studio aliases before comparing compatibility fields', () => {
  const row = follow()
  expect(
    normalizeRules(
      {
        voicePolicy: { mode: 'only', studio: ' HDRezka ' },
        voiceStudio: 'HDRezka Studio',
        voiceStrict: true,
      },
      row,
    ),
  ).toMatchObject({
    voiceMode: 'only',
    voiceStudio: 'HDRezka Studio',
    voiceStrict: true,
  })
  expect(
    normalizeRules(
      {
        voicePolicy: { mode: 'prefer', studio: 'RedHeadSound' },
        voiceStudio: 'Red Head Sound',
        voiceStrict: false,
      },
      row,
    ),
  ).toMatchObject({
    voiceMode: 'prefer',
    voiceStudio: 'Red Head Sound',
    voiceStrict: false,
  })
  expect(
    normalizeRules(
      {
        voicePolicy: { mode: 'only', studio: 'HDRezka Studio' },
        voiceStudio: 'HDRezka',
      },
      row,
    ).voiceStudio,
  ).toBe('HDRezka Studio')
  expect(normalizeRules({ voiceStudio: 'RedHeadSound' }, row)).toMatchObject({
    voiceMode: 'prefer',
    voiceStudio: 'Red Head Sound',
  })
})

it('preserves unchanged unknown legacy studio while rejecting unknown modern intent', () => {
  const row = { ...follow(), voiceStudio: 'Private Studio', voiceStrict: true }
  expect(
    normalizeRules(
      { voiceStudio: 'Private Studio', voiceStrict: true, waitHours: 12 },
      row,
    ),
  ).toEqual({
    voiceStudio: 'Private Studio',
    voiceStrict: true,
    waitHours: 12,
  })
  for (const studio of ['HDRezka Studo', 'RHS']) {
    for (const mode of ['prefer', 'only'] as const) {
      expect(() =>
        normalizeRules({ voicePolicy: { mode, studio } }, row),
      ).toThrow()
    }
  }
})

it('keeps legacy unknown changes explicit and preserves modern mode for equivalent old aliases', () => {
  const row = {
    ...follow(),
    voiceMode: 'only' as const,
    voiceStudio: 'HDRezka Studio',
    voiceStrict: true,
  }
  expect(
    normalizeRules(
      { voiceStudio: 'HDRezka', voiceStrict: true, qualityPreset: 'compact' },
      row,
    ),
  ).toEqual({
    voiceStudio: 'HDRezka Studio',
    voiceStrict: true,
    qualityPreset: 'compact',
  })
  expect(
    normalizeRules({ voiceStudio: 'Private Studio', voiceStrict: true }, row),
  ).toMatchObject({
    voiceMode: null,
    voiceStudio: 'Private Studio',
    voiceStrict: true,
  })
})
