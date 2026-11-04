import type { z } from 'zod'
import type { MaintenanceEpisode, SeedRule } from '../../db/schema.ts'
import type {
  maintenanceReasons,
  maintenanceRuleInput,
} from '../../dto/libraryMaintenance.ts'

export type Rule = z.infer<typeof maintenanceRuleInput>
export type Reason = z.infer<typeof maintenanceReasons>
export const DAY = 86_400_000
export interface CandidateGroup {
  id: string
  revision: number
  titleId: string
  protected: boolean
  proven: boolean
  episodes: MaintenanceEpisode[]
  files: {
    name: string
    kind: 'source' | 'library' | 'sidecar'
    size: number
    volume: string | null
    allocationKey?: string
  }[]
  reasons: Reason[]
  seedRule: SeedRule | null
  completedAt: number | null
  uploaded: number | null
  denominator: number | null
  lastActivityAt: number | null
  eligibleSince: number | null
}
export interface EvaluationSnapshot {
  now: number
  rule: Rule
  rosterChanged: boolean
  profiles: string[]
  favorite: boolean
  followState: string | null
  available: { id: string, episodes: MaintenanceEpisode[] }[]
  progress: {
    profileId: string
    season: number
    episode: number
    watchedAt: number | null
    lastPlayedAt: number | null
  }[]
  groups: CandidateGroup[]
}
function key(episode: MaintenanceEpisode) {
  return `${episode.season}:${episode.episode}`
}
function iso(time: number | null) {
  return time === null ? null : new Date(time).toISOString()
}

/** Чистая проверка: ни она, ни предпросмотр не запускают отсчёт grace. */
export function evaluateMaintenance(snapshot: EvaluationSnapshot) {
  const { rule, now } = snapshot
  const available = new Map<string, Set<string>>()
  for (const file of snapshot.available) {
    for (const episode of file.episodes) {
      const ids = available.get(key(episode)) ?? new Set<string>()
      ids.add(file.id)
      available.set(key(episode), ids)
    }
  }
  const latest = new Set(
    [...available.keys()]
      .filter(item => Number(item.split(':')[0]) > 0)
      .sort((a, b) => {
        const [as, ae] = a.split(':').map(Number) as [number, number]
        const [bs, be] = b.split(':').map(Number) as [number, number]
        return bs - as || be - ae
      })
      .slice(0, rule.keepLast ?? 0),
  )

  const groups = snapshot.groups.map((group) => {
    const reasons = new Set<Reason>(group.reasons)
    if (!rule.enabled)
      reasons.add('disabled')
    if (!group.proven)
      reasons.add('legacy')
    if (group.protected)
      reasons.add('manual_protection')
    if (snapshot.favorite)
      reasons.add('favorite')
    if (!['active', 'done'].includes(snapshot.followState ?? ''))
      reasons.add('follow_inactive')
    if (snapshot.rosterChanged)
      reasons.add('profiles_changed')
    if (
      !rule.profileIds.length
      || rule.profileIds.some(id => !snapshot.profiles.includes(id))
    ) {
      reasons.add('profile_missing')
    }
    if (!group.episodes.length)
      reasons.add('unknown_identity')
    let last = group.lastActivityAt
    for (const episode of group.episodes) {
      if (latest.has(key(episode)))
        reasons.add('latest_episodes')
      if ((available.get(key(episode))?.size ?? 0) > 1)
        reasons.add('ambiguous_versions')
      const progress = snapshot.progress.filter(
        row => key(row) === key(episode),
      )
      for (const profileId of rule.profileIds) {
        const watched = progress.find(
          row => row.profileId === profileId,
        )?.watchedAt
        if (watched === null || watched === undefined)
          reasons.add('not_watched')
        else last = Math.max(last ?? -Infinity, watched)
      }
      for (const row of progress) {
        if (row.lastPlayedAt !== null)
          last = Math.max(last ?? -Infinity, row.lastPlayedAt)
      }
    }
    if (
      (last !== null && last > now)
      || (group.completedAt ?? 0) > now
      || (group.eligibleSince ?? 0) > now
    ) {
      reasons.add('clock_invalid')
    }
    const eligibleAt = last === null ? null : last + rule.days * DAY
    if (eligibleAt !== null && now < eligibleAt)
      reasons.add('retention_period')
    const seed = group.seedRule
    if (!seed) {
      reasons.add('seeding_unknown')
    }
    else if (seed.mode === 'always') {
      reasons.add('seeding_always')
    }
    else if (seed.mode === 'time') {
      if (group.completedAt === null || seed.minutes === undefined)
        reasons.add('seeding_unknown')
      else if (now - group.completedAt < seed.minutes * 60_000)
        reasons.add('seeding_incomplete')
    }
    else if (seed.mode === 'ratio') {
      if (
        group.uploaded === null
        || !group.denominator
        || seed.ratio === undefined
      ) {
        reasons.add('seeding_unknown')
      }
      else if (group.uploaded / group.denominator < seed.ratio) {
        reasons.add('seeding_incomplete')
      }
    }
    // Candidate означает соответствие правилам, а не разрешение удаления.
    // Планировщик сохраняет первое совпадение и проверяет его ещё раз через 24 ч.
    const candidate = reasons.size === 0
    if (
      candidate
      && (group.eligibleSince === null || now - group.eligibleSince < DAY)
    ) {
      reasons.add('grace_period')
    }
    return {
      id: group.id,
      revision: group.revision,
      titleId: group.titleId,
      protected: group.protected,
      candidate,
      reasons: [...reasons],
      eligibleAt: iso(eligibleAt),
      eligibleSince: iso(group.eligibleSince),
      episodes: group.episodes,
      files: group.files,
      logicalBytes: [
        ...new Map(
          group.files.map((file, index) => [
            file.allocationKey ?? String(index),
            file.size,
          ]),
        ).values(),
      ].reduce((sum, size) => sum + size, 0),
    }
  })
  const volumes = new Map<string | null, number>()
  const allocations = new Set<string>()
  for (const group of groups.filter(group => group.candidate)) {
    for (const file of group.files) {
      if (file.allocationKey && allocations.has(file.allocationKey))
        continue
      if (file.allocationKey)
        allocations.add(file.allocationKey)
      volumes.set(file.volume, (volumes.get(file.volume) ?? 0) + file.size)
    }
  }
  return {
    evaluatedAt: iso(now)!,
    executorAvailable: false as const,
    estimate: true as const,
    groups,
    volumes: [...volumes].map(([volume, logicalBytes]) => ({
      volume,
      logicalBytes,
    })),
  }
}
