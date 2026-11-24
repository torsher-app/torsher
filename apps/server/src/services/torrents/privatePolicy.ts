import type { SeedObligationRequirement } from '../../db/schema.ts'

export type TorznabSeedType = 'ratio' | 'seedtime' | 'both' | 'either'

export interface TorrentSourcePolicy {
  id: string
  name: string
  isPrivate: boolean
  minSeedRatio: number | null
  minSeedTimeMinutes: number | null
  seedCriteriaMode: 'or' | 'and' | null
  minimumRatio?: number | null
  minimumSeedTimeMinutes?: number | null
  seedType?: TorznabSeedType | null
}

export function snapshotSeedObligations(
  policy?: TorrentSourcePolicy,
): SeedObligationRequirement[] {
  const requirements: SeedObligationRequirement[] = []
  let ratio = policy?.minimumRatio ?? null
  let minutes = policy?.minimumSeedTimeMinutes ?? null
  const type = policy?.seedType
  const mode = policy?.seedCriteriaMode ?? 'and'

  if (type === 'ratio')
    minutes = null
  if (type === 'seedtime')
    ratio = null

  if (type || ratio !== null || minutes !== null) {
    const unknown
      = type === 'both'
        ? ratio === null || minutes === null
        : ratio === null && minutes === null
    requirements.push({
      origin: 'tracker',
      mode: type === 'either' ? 'or' : type ? 'and' : mode,
      ratio,
      minutes,
      ...(unknown ? { unknown } : {}),
    })
  }

  const sourceRatio = policy?.minSeedRatio ?? null
  const sourceMinutes = policy?.minSeedTimeMinutes ?? null
  if (sourceRatio !== null || sourceMinutes !== null) {
    requirements.push({
      origin: 'source',
      mode,
      ratio: sourceRatio,
      minutes: sourceMinutes,
    })
  }

  if (requirements.length === 0) {
    requirements.push({
      origin: 'tracker',
      mode: 'and',
      ratio: null,
      minutes: null,
      unknown: true,
    })
  }

  return requirements
}
