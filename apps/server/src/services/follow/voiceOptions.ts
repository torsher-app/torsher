import type { z } from 'zod'
import type { followVoicesResponse } from '../../dto/follow.ts'
import { getTitleSources, voiceOptions } from '../sources/index.ts'
import { peekSearch, SEARCH_TTL_MS } from '../sources/cache.ts'
import { rankReleases } from '../sources/rank.ts'
import { sourceProfile } from '../sources/profile.ts'
import { listSearchableIndexers } from '../indexers/index.ts'
import { followOf } from './index.ts'
import { resolveVoice } from './voice.ts'

type Response = z.output<typeof followVoicesResponse>

/** Cache-only reads must not fetch identity or synchronize aliases. */
export async function followVoiceOptions(
  titleId: string,
  season: number,
  refresh = false,
): Promise<Response> {
  const refreshed = refresh
    ? await getTitleSources(titleId, { season, refresh: true })
    : undefined
  const entries = [
    peekSearch(`${titleId}:${season}`),
    peekSearch(`${titleId}:all`),
  ].filter(entry => !!entry)
  const releases = [
    ...new Map(
      entries
        .flatMap(entry => entry.outcome.releases)
        .filter(
          release => season === 0 || release.parsed.seasons.includes(season),
        )
        .map(release => [release.id, release]),
    ).values(),
  ]
  const ranked = rankReleases(releases, {
    kind: season === 0 ? 'movie' : 'series',
    profile: { ...sourceProfile(), audioLanguages: ['ru'] },
  }).ranked
  const options = new Map<string, Response['items'][number]>()
  for (const option of voiceOptions(ranked, undefined)) {
    if (!option.studio)
      continue
    const types = [
      ...new Set(
        ranked
          .filter(release => release.match.confidence === 'high')
          .flatMap(release => release.voices)
          .filter(voice => voice.studio === option.studio)
          .flatMap(voice => (voice.type ? [voice.type] : [])),
      ),
    ]
    options.set(option.studio, {
      studio: option.studio,
      types,
      count: option.count,
      seeders: option.seeders,
      maxQuality: option.maxQuality,
      found: true,
      saved: false,
      inherited: false,
    })
  }
  const follow = followOf(titleId)
  const resolved
    = follow
      && resolveVoice({ ...follow, audio: 'ru', voiceMode: 'auto' }, season)
  for (const [studio, saved, inherited] of [
    [follow?.voiceStudio, true, false],
    [resolved?.studio, false, resolved?.source === 'inherited_pin'],
  ] as const) {
    if (!studio)
      continue
    const item = options.get(studio) ?? {
      studio,
      types: [],
      count: 0,
      seeders: 0,
      found: false,
      saved: false,
      inherited: false,
    }
    item.saved ||= saved
    item.inherited ||= inherited
    options.set(studio, item)
  }
  const dates = entries.map(entry => entry.updatedAt.getTime())
  if (refreshed)
    dates.push(refreshed.updatedAt.getTime())
  const updatedAt = dates.length ? Math.max(...dates) : null
  return {
    season,
    updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
    cache: updatedAt === null ? 'miss' : 'hit',
    stale: updatedAt !== null && Date.now() - updatedAt >= SEARCH_TTL_MS,
    indexerCount:
      refreshed?.indexerCount
      ?? Math.max(
        listSearchableIndexers().length,
        ...entries.map(entry => entry.outcome.indexerCount),
      ),
    failed: refreshed?.failed ?? [
      ...new Map(
        entries
          .flatMap(entry => entry.outcome.failed)
          .map(failure => [failure.id, failure]),
      ).values(),
    ],
    items: [...options.values()].sort(
      (a, b) =>
        Number(b.saved) - Number(a.saved)
        || b.count - a.count
        || a.studio.localeCompare(b.studio),
    ),
  }
}
