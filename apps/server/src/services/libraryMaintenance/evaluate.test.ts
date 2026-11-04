import type { EvaluationSnapshot } from './evaluate.ts'
import { describe, expect, it } from 'vitest'
import { DAY, evaluateMaintenance } from './evaluate.ts'

const now = Date.UTC(2026, 10, 3)
function snapshot(): EvaluationSnapshot {
  return {
    now,
    rule: { enabled: true, days: 2, keepLast: null, profileIds: ['a', 'b'] },
    rosterChanged: false,
    profiles: ['a', 'b', 'c'],
    favorite: false,
    followState: 'active',
    available: [{ id: 'file', episodes: [{ season: 1, episode: 1 }] }],
    progress: ['a', 'b'].map(profileId => ({
      profileId,
      season: 1,
      episode: 1,
      watchedAt: now - 2 * DAY,
      lastPlayedAt: null,
    })),
    groups: [
      {
        id: 'group',
        revision: 1,
        titleId: 'tmdb:tv:1',
        protected: false,
        proven: true,
        episodes: [{ season: 1, episode: 1 }],
        files: [
          { name: 'Synthetic.mkv', kind: 'library', size: 10, volume: '1' },
        ],
        reasons: [],
        seedRule: { mode: 'never' },
        completedAt: now - 3 * DAY,
        uploaded: 0,
        denominator: 10,
        lastActivityAt: null,
        eligibleSince: null,
      },
    ],
  }
}
function result(value: EvaluationSnapshot) {
  return evaluateMaintenance(value).groups[0]!
}
describe('maintenance evaluator', () => {
  it('requires every selected profile and the full 24-hour boundary', () => {
    const input = snapshot()
    expect(result(input)).toMatchObject({
      candidate: true,
      reasons: ['grace_period'],
      eligibleSince: null,
    })
    input.now--
    expect(result(input).reasons).toContain('retention_period')
    input.progress[1]!.watchedAt = null
    expect(result(input).reasons).toContain('not_watched')
  })
  it('extends delay for an unselected profile and raw playback', () => {
    const input = snapshot()
    input.progress.push({
      profileId: 'c',
      season: 1,
      episode: 1,
      watchedAt: null,
      lastPlayedAt: now - DAY,
    })
    expect(result(input).eligibleAt).toBe(new Date(now + DAY).toISOString())
    input.groups[0]!.lastActivityAt = now
    expect(result(input).eligibleAt).toBe(
      new Date(now + 2 * DAY).toISOString(),
    )
  })
  it('collects independent blockers and handles roster changes and future clocks', () => {
    const input = snapshot()
    input.rule.enabled = false
    input.rosterChanged = true
    input.profiles = ['a']
    input.favorite = true
    input.followState = 'paused'
    input.groups[0]!.protected = true
    input.groups[0]!.proven = false
    input.groups[0]!.lastActivityAt = now + 1
    expect(result(input).reasons).toEqual(
      expect.arrayContaining([
        'disabled',
        'profiles_changed',
        'profile_missing',
        'favorite',
        'follow_inactive',
        'manual_protection',
        'legacy',
        'clock_invalid',
      ]),
    )
  })
  it('protects the last unique available regular episodes across seasons, not specials or downloading', () => {
    const input = snapshot()
    input.rule.keepLast = 1
    input.available.push(
      { id: 'next', episodes: [{ season: 2, episode: 1 }] },
      { id: 'special', episodes: [{ season: 0, episode: 99 }] },
    )
    expect(result(input).reasons).not.toContain('latest_episodes')
    input.rule.keepLast = 3
    expect(result(input).reasons).toContain('latest_episodes')
  })
  it('keeps a multi-episode file indivisible and blocks multiple versions', () => {
    const input = snapshot()
    input.groups[0]!.episodes.push({ season: 1, episode: 2 })
    input.available[0]!.episodes.push({ season: 1, episode: 2 })
    input.rule.keepLast = 1
    expect(result(input).reasons).toEqual(
      expect.arrayContaining(['latest_episodes', 'not_watched']),
    )
    input.available.push({
      id: 'version2',
      episodes: [{ season: 1, episode: 1 }],
    })
    expect(result(input).reasons).toContain('ambiguous_versions')
  })
  it('supports done movies and never persists first eligibility', () => {
    const input = snapshot()
    input.followState = 'done'
    input.groups[0]!.titleId = 'tmdb:movie:1'
    const original = structuredClone(input)
    expect(result(input).candidate).toBe(true)
    expect(input).toEqual(original)
  })
  it('honors ratio, time, unknown and always seeding goals even for orphan copies', () => {
    const input = snapshot()
    const group = input.groups[0]!
    group.seedRule = { mode: 'always' }
    expect(result(input).reasons).toContain('seeding_always')
    group.seedRule = { mode: 'ratio', ratio: 2 }
    group.uploaded = 19
    expect(result(input).reasons).toContain('seeding_incomplete')
    group.uploaded = 20
    expect(result(input).candidate).toBe(true)
    group.denominator = null
    expect(result(input).reasons).toContain('seeding_unknown')
    group.seedRule = { mode: 'time', minutes: 60 }
    group.completedAt = now - 60 * 60000 + 1
    expect(result(input).reasons).toContain('seeding_incomplete')
  })
})

it('accepts epoch zero and counts shared hardlink allocation once', () => {
  const input = snapshot()
  input.now = 2 * DAY
  input.progress = input.progress.map(row => ({
    ...row,
    watchedAt: 0,
    lastPlayedAt: null,
  }))
  input.groups[0]!.completedAt = 0
  input.groups[0]!.files = [
    {
      name: 'source',
      kind: 'source',
      size: 10,
      volume: '1',
      allocationKey: '1:123',
    },
    {
      name: 'library',
      kind: 'library',
      size: 10,
      volume: '1',
      allocationKey: '1:123',
    },
    {
      name: 'copy',
      kind: 'library',
      size: 10,
      volume: '2',
      allocationKey: '2:456',
    },
  ]
  expect(result(input).eligibleAt).toBe(new Date(2 * DAY).toISOString())
  expect(result(input).logicalBytes).toBe(20)
  expect(evaluateMaintenance(input).volumes).toEqual([
    { volume: '1', logicalBytes: 10 },
    { volume: '2', logicalBytes: 10 },
  ])
})
