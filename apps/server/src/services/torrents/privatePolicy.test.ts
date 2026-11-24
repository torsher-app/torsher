import type { TorrentSourcePolicy } from './privatePolicy.ts'
import { describe, expect, it } from 'vitest'
import { snapshotSeedObligations } from './privatePolicy.ts'
import { evaluateSeedObligation } from './seeding.ts'

const source: TorrentSourcePolicy = {
  id: 'private',
  name: 'Private Indexer',
  isPrivate: true,
  minSeedRatio: null,
  minSeedTimeMinutes: null,
  seedCriteriaMode: null,
}

const torrent = {
  isPrivate: true,
  files: [{ path: 'fixture.bin', padding: false, size: 100 }],
  trackerErrorCode: null,
  seededSeconds: 120,
  startAnnounceState: null,
}

const complete = {
  uploaded: 100,
  verifiedComplete: true,
  leftZeroAccepted: true,
  seededSeconds: 60,
}

describe('private seeding obligations', () => {
  it.each([
    ['ratio', true],
    ['seedtime', false],
    ['both', false],
    ['either', true],
    [undefined, false],
  ] as const)('checks mode %s', (seedType, met) => {
    const seedObligations = snapshotSeedObligations({
      ...source,
      minimumRatio: 1,
      minimumSeedTimeMinutes: 2,
      seedType,
    })
    expect(
      evaluateSeedObligation({ ...torrent, seedObligations }, complete)?.met,
    ).toBe(met)
  })

  it('requires both the release rule and the independent source rule', () => {
    const seedObligations = snapshotSeedObligations({
      ...source,
      minSeedRatio: 1.5,
      minimumRatio: 1,
      minimumSeedTimeMinutes: 2,
      seedCriteriaMode: 'or',
    })
    const row = { ...torrent, seedObligations }
    expect(evaluateSeedObligation(row, complete)?.met).toBe(false)
    expect(
      evaluateSeedObligation(row, { ...complete, uploaded: 150 })?.met,
    ).toBe(true)
    expect(
      evaluateSeedObligation(row, {
        ...complete,
        uploaded: 150,
        leftZeroAccepted: false,
      })?.met,
    ).toBe(false)
    expect(evaluateSeedObligation(row)?.met).toBe(false)
  })

  it('keeps absent or incomplete rules protected and excludes public torrents', () => {
    const seedObligations = snapshotSeedObligations({
      ...source,
      seedType: 'both',
      minimumRatio: 1,
    })
    expect(
      evaluateSeedObligation({ ...torrent, seedObligations }, complete),
    ).toMatchObject({ unknown: true, met: false })
    expect(
      evaluateSeedObligation(
        { ...torrent, seedObligations: snapshotSeedObligations() },
        complete,
      ),
    ).toMatchObject({ unknown: true, met: false })
    expect(
      evaluateSeedObligation(
        { ...torrent, isPrivate: false, seedObligations },
        complete,
      ),
    ).toBeNull()
  })

  it('does not use previously saved seeding time to satisfy current zero progress', () => {
    const seedObligations = snapshotSeedObligations({
      ...source,
      minSeedTimeMinutes: 1,
    })
    expect(
      evaluateSeedObligation(
        { ...torrent, seedObligations },
        { ...complete, seededSeconds: undefined },
      )?.met,
    ).toBe(false)
  })
})
