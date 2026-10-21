import type { Resolution, VoiceType } from '@torsher/release-parser'
import type { TitleIdentity } from '../tmdb/index.ts'
import type { VoiceRef } from './profile.ts'
import type { RankedRelease, Ranking } from './rank.ts'
import type { IndexerFailure } from './search.ts'
import { listSearchableIndexers } from '../indexers/index.ts'
import { getTitleIdentity } from '../tmdb/index.ts'
import { syncTitleAliases } from './aliases.ts'
import { cachedSearch } from './cache.ts'
import { DEFAULT_PROFILE } from './profile.ts'
import { coversEpisode, rankReleases, RESOLUTION_RANK } from './rank.ts'
import { searchReleases } from './search.ts'
import { lastVoiceOfSeason } from './progress.ts'
import { getPinnedVoice } from './voices.ts'

export type { RankingProfile, VoiceRef } from './profile.ts'
export { DEFAULT_PROFILE } from './profile.ts'
export type { RankedRelease, SourceReason } from './rank.ts'
export { pinVoice } from './voices.ts'

export interface SourcesRequest {
  season?: number
  episode?: number
  refresh?: boolean
  /** Чей прогресс подсказывает «Как в прошлых сериях» */
  profileId?: string
}

/** Озвучка среди найденных раздач: для панели «Озвучка» */
export interface VoiceOption {
  key: string
  studio?: string
  type?: VoiceType
  maxQuality?: Resolution
  seeders: number
  count: number
  pinned: boolean
}

export interface TitleSources {
  identity: TitleIdentity
  season?: number
  episode?: number
  updatedAt: Date
  ranking: Ranking
  voices: VoiceOption[]
  pinned?: VoiceRef
  indexerCount: number
  failed: IndexerFailure[]
}

/** Сезон, по которому ищем: у фильма нет, у сериала по умолчанию первый */
function seasonOf(identity: TitleIdentity, season: number | undefined) {
  return identity.kind === 'movie' ? undefined : (season ?? 1)
}

export function voiceKeyOf(voice: { studio?: string, type?: string }) {
  return voice.studio ? `studio:${voice.studio}` : `type:${voice.type ?? 'ru'}`
}

function voiceOptions(ranked: RankedRelease[], pinned: VoiceRef | undefined) {
  const options = new Map<string, VoiceOption>()
  const pinnedKey = pinned ? voiceKeyOf(pinned) : undefined

  for (const release of ranked) {
    if (!release.voice || release.match.confidence !== 'high')
      continue

    const key = voiceKeyOf(release.voice)
    const quality = release.parsed.quality
    const option = options.get(key) ?? {
      key,
      studio: release.voice.studio,
      type: release.voice.type,
      seeders: 0,
      count: 0,
      pinned: key === pinnedKey,
    }

    option.count += 1
    option.seeders = Math.max(option.seeders, release.seeders)

    if (
      quality
      && (!option.maxQuality
        || RESOLUTION_RANK[quality] > RESOLUTION_RANK[option.maxQuality])
    ) {
      option.maxQuality = quality
    }

    options.set(key, option)
  }

  return [...options.values()].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.seeders - a.seeders,
  )
}

/**
 * Раздачи тайтла для карточки: поиск по индексаторам (из кэша, если свежий),
 * отбор по серии, ранжирование по профилю с закреплённой озвучкой сезона.
 * `undefined` — ID не из каталога.
 */
export async function getTitleSources(
  titleId: string,
  request: SourcesRequest = {},
): Promise<TitleSources | undefined> {
  const identity = await getTitleIdentity(titleId)

  if (!identity)
    return undefined

  const season = seasonOf(identity, request.season)
  const episode = season === undefined ? undefined : request.episode
  const aliases = syncTitleAliases(titleId, identity)
  const search = await cachedSearch(
    `${titleId}:${season ?? 0}`,
    () =>
      searchReleases({ identity, aliases, season }, listSearchableIndexers()),
    { refresh: request.refresh },
  )
  const releases
    = episode === undefined
      ? search.outcome.releases
      : search.outcome.releases.filter(release =>
          coversEpisode(release.parsed, episode),
        )
  // Выбор в панели «Озвучка» сильнее студии, которой смотрели прошлые серии
  const pinned
    = getPinnedVoice(titleId, season ?? 0)
      ?? (season === undefined || !request.profileId
        ? undefined
        : lastVoiceOfSeason(request.profileId, titleId, season))
  const ranking = rankReleases(releases, {
    kind: identity.kind,
    profile: DEFAULT_PROFILE,
    pinned,
  })

  return {
    identity,
    season,
    episode,
    updatedAt: search.updatedAt,
    ranking,
    voices: voiceOptions(ranking.ranked, pinned),
    pinned,
    indexerCount: search.outcome.indexerCount,
    failed: search.outcome.failed,
  }
}
