import type { VideoClass, VoiceType } from '@torsher/release-parser'
import type { TitleIdentity } from '../tmdb/index.ts'
import type { VoiceRef } from './profile.ts'
import type { RankedRelease, Ranking } from './rank.ts'
import type { IndexerFailure } from './search.ts'
import { recordTrackerEpisodes } from '../follow/trackerEpisodes.ts'
import { listSearchableIndexers } from '../indexers/index.ts'
import { getTitleIdentity } from '../tmdb/index.ts'
import { normalizeTitle } from '@torsher/release-parser'
import { queryCombos, syncTitleAliases } from './aliases.ts'
import { cachedSearch } from './cache.ts'
import { DEFAULT_PROFILE } from './profile.ts'
import { coversEpisode, rankReleases, RESOLUTION_RANK } from './rank.ts'
import { knownResolutions } from './resolution.ts'
import { asViewerSearch, searchReleases } from './search.ts'
import { lastTitleProgress, lastVoiceOfSeason } from './progress.ts'
import { getPinnedVoice } from './voices.ts'
import { seasonReleases } from './seasonRelease.ts'
import { getTorrent } from '../torrents/index.ts'

export type { RankingProfile, VoiceRef } from './profile.ts'
export { DEFAULT_PROFILE } from './profile.ts'
export type { RankedRelease, SourceReason } from './rank.ts'
export { pinVoice } from './voices.ts'

export interface SourcesRequest {
  season?: number
  episode?: number
  /** Раздачи всех сезонов сериала: экран «Источники» */
  allSeasons?: boolean
  refresh?: boolean
  /** Чей прогресс подсказывает «Как в прошлых сериях» */
  profileId?: string
  /** Строка зрителя вместо автоматического поиска («Уточнить запрос») */
  query?: string
}

/** Озвучка среди найденных раздач: для панели «Озвучка» */
export interface VoiceOption {
  key: string
  studio?: string
  type?: VoiceType
  maxQuality?: VideoClass
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
  /** Кандидат, который и есть раздача сезона (`seasonReleases`) */
  seasonCandidate?: string
  /** Кандидаты, раздачу которых уже добавляли для этого тайтла */
  /** Кандидат, раздачей которого смотрели последний раз. */
  lastWatchedId?: string
  /** Строка зрителя, по которой искали; без неё — автоматический поиск */
  query?: string
  /** Готовые строки для «Уточнить запрос» */
  querySuggestions: string[]
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

/** Ключи озвучек раздачи без повторов: `| P, P2` и `| MVO (LostFilm)` дают разные */
export function voiceKeysOf(release: Pick<RankedRelease, 'voices'>) {
  return [...new Set(release.voices.map(voiceKeyOf))]
}

function voiceOptions(ranked: RankedRelease[], pinned: VoiceRef | undefined) {
  const options = new Map<string, VoiceOption>()
  const pinnedKey = pinned ? voiceKeyOf(pinned) : undefined

  for (const release of ranked) {
    if (release.match.confidence !== 'high')
      continue

    // «Лучшее качество» озвучки — только точное разрешение, без вывода
    const quality = release.resolution?.sure
      ? release.resolution.value
      : undefined

    // Раздача с несколькими озвучками есть в каждой из них
    for (const key of voiceKeysOf(release)) {
      const voice = release.voices.find(track => voiceKeyOf(track) === key)!
      const option = options.get(key) ?? {
        key,
        studio: voice.studio,
        type: voice.type,
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

  const season = request.allSeasons
    ? undefined
    : seasonOf(identity, request.season)
  const episode = season === undefined ? undefined : request.episode
  const aliases = syncTitleAliases(titleId, identity)
  const query = request.query?.trim() || undefined
  const scope = `${titleId}:${request.allSeasons ? 'all' : (season ?? 0)}`
  const search = await cachedSearch(
    query ? `${scope}:q:${normalizeTitle(query) || query}` : scope,
    () =>
      asViewerSearch(() =>
        searchReleases(
          { identity, aliases, season, query },
          listSearchableIndexers(),
        ),
      ),
    { refresh: request.refresh },
  )

  if (identity.kind === 'series')
    await recordTrackerEpisodes(titleId, search.outcome.releases)

  const releases
    = episode === undefined
      ? search.outcome.releases
      : search.outcome.releases.filter(release =>
          coversEpisode(release.parsed, episode),
        )
  // Раздачи всех сезонов: советуем для сезона, который смотрят, без
  // просмотра — для первого
  const focusSeason
    = request.allSeasons && identity.kind === 'series'
      ? ((request.profileId
          ? lastTitleProgress(request.profileId, titleId)?.season
          : undefined) ?? 1)
      : undefined
  const voiceSeason = season ?? focusSeason
  // Выбор в панели «Озвучка» сильнее студии, которой смотрели прошлые серии
  const pinned
    = getPinnedVoice(titleId, voiceSeason ?? 0)
      ?? (voiceSeason === undefined || !request.profileId
        ? undefined
        : lastVoiceOfSeason(request.profileId, titleId, voiceSeason))
  const ranking = rankReleases(releases, {
    kind: identity.kind,
    originalLanguage: identity.originalLanguage,
    episodeCounts: identity.episodeCounts,
    profile: DEFAULT_PROFILE,
    pinned,
    known: knownResolutions(releases),
    focusSeason,
  })

  const seasonTorrent
    = season === undefined || !request.profileId
      ? undefined
      : seasonReleases(request.profileId, titleId).find(
        release => release.season === season,
      )?.torrent
  const seasonCandidate = seasonTorrent
    ? ranking.ranked.find(
      release =>
        release.infoHash?.toLowerCase()
        === seasonTorrent.infoHash.toLowerCase(),
    )?.id
    : undefined

  const lastTorrentId = request.profileId
    ? lastTitleProgress(request.profileId, titleId)?.torrentId
    : undefined
  const lastHash = lastTorrentId
    ? getTorrent(lastTorrentId)?.infoHash.toLowerCase()
    : undefined
  const lastWatchedId = lastHash
    ? ranking.ranked.find(
      release => release.infoHash?.toLowerCase() === lastHash,
    )?.id
    : undefined

  return {
    identity,
    season,
    episode,
    updatedAt: search.updatedAt,
    ranking,
    seasonCandidate,
    lastWatchedId,
    query,
    querySuggestions: queryCombos(aliases, identity.year),
    voices: voiceOptions(ranking.ranked, pinned),
    pinned,
    indexerCount: search.outcome.indexerCount,
    failed: search.outcome.failed,
  }
}
