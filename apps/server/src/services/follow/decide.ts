import type { VideoClass } from '@torsher/release-parser'
import type { FollowQualityPreset } from '../../db/schema.ts'
import type { RankingProfile, VoiceRef } from '../sources/profile.ts'
import type { RankedRelease } from '../sources/rank.ts'
import type { BlockedReleases } from './blocklist.ts'
import type { OrderedCandidate } from './rank.ts'
import type { TopicKey } from './topics.ts'
import type {
  ReleaseVersion,
  UpgradeCheck,
  VersionPosition,
} from './upgrade.ts'
import type { EpisodeRef } from './wanted.ts'
import {
  RESOLUTION_RANK,
  SCREEN_COPIES,
  SIZE_CORRIDOR,
  voiceMatches,
} from '../sources/rank.ts'
import { isDigitalSource } from './availability.ts'
import { blockedPart } from './blocklist.ts'
import { compareCandidates, ladderStep, QUALITY_LADDERS } from './rank.ts'
import { isUpgrade } from './upgrade.ts'
import { episodeKey } from './wanted.ts'

const HOUR_MS = 60 * 60 * 1000
// Столько серий сезона должно прийти без верхней ступени, чтобы cutoff по
// качеству опустился до лучшей увиденной: русское ТВ бывает только в 720p
const SEEN_FOR_LOWER_CUTOFF = 3
// «Далеко вне коридора»: в разы меньше или больше разумного размера серии
const SIZE_FAR_BELOW = 0.5
const SIZE_FAR_ABOVE = 2

/**
 * Почему кандидат не берётся. Постоянный отказ — раздача не подходит совсем,
 * временный — пока не подходит (нет сидов, ждём лучшее, фильм ещё не вышел
 * в цифре). `not_better`, `watched`, `manual` — серию в библиотеке не
 * заменяем.
 */
export type RejectionCode
  = | 'title_unsure'
    | 'screen_copy'
    | 'no_russian'
    | 'quality'
    | 'size'
    | 'blocklisted'
    | 'voice_strict'
    | 'no_wanted'
    | 'already_downloading'
    | 'no_seeders'
    | 'wait'
    | 'outranked'
    | 'not_available'
    | 'not_better'
    | 'watched'
    | 'manual'

export type RejectionType = 'permanent' | 'temporary'

export interface Rejection {
  code: RejectionCode
  type: RejectionType
  /** Для текста на языке зрителя: студия, качество, срок */
  params?: Record<string, string | number>
}

const TEMPORARY: ReadonlySet<RejectionCode> = new Set([
  'already_downloading',
  'no_seeders',
  'wait',
  'outranked',
  'not_available',
])

// Почему не заменяем серию в библиотеке: самое окончательное — первым
const UPGRADE_REJECTIONS: RejectionCode[] = ['manual', 'watched', 'not_better']

function reject(code: RejectionCode, params?: Rejection['params']): Rejection {
  return {
    code,
    type: TEMPORARY.has(code) ? 'temporary' : 'permanent',
    ...(params && { params }),
  }
}

/** Правила слежения и знание о сериях, общее для всех сезонов */
export interface DecideContext {
  kind: 'movie' | 'series'
  preset: FollowQualityPreset
  voiceStrict: boolean
  requireRussian: boolean
  waitHours: number
  /** Оригинал на русском: озвучка не нужна, любая раздача «своя» */
  russianOriginal: boolean
  profile: RankingProfile
  /** Серий в сезонах по TMDB: что в паке без диапазона */
  episodeCounts?: Record<number, number>
  /** Нужные серии (`episodeKey`) */
  wanted: Set<string>
  downloading: Set<string>
  blocked: BlockedReleases
  /** Первое появление серии: старт окна ожидания */
  firstSeen: Map<string, Date>
  /**
   * Серии в библиотеке, которые рассматривает апгрейд: текущая версия или
   * почему не заменяем
   */
  upgrades?: Map<string, UpgradeCheck>
  /**
   * Фильм ещё не вышел в цифре — берём только раздачи из цифры: дата
   * доступности, `null` — дат нет. У сериала и вышедшего фильма — нет поля
   */
  unavailableUntil?: Date | null
  now: Date
}

/** Сезон, который решается: своя студия, ступень cutoff и его тема */
export interface SeasonContext {
  season: number
  voice?: VoiceRef
  cutoffStep: number
  topic?: TopicKey
}

export interface CheckedCandidate extends OrderedCandidate {
  /** Нужные и заменяемые (апгрейд) серии сезона, которые раздача закрывает */
  episodes: EpisodeRef[]
  /** Из них серии в библиотеке, которые раздача заменит: без окна ожидания */
  upgrades: Set<string>
  /** Нужные и рассмотренные апгрейдом серии раздачи: для снимка */
  considered: EpisodeRef[]
  /** Почему раздача не заменит серию в библиотеке */
  episodeRejections: Map<string, Rejection>
  /** Озвучка уже та, которую ждём */
  voiceAtCutoff: boolean
  rejections: Rejection[]
}

/** Сезоны раздачи; сериал без сезона в названии — первый, фильм — 0 */
export function releaseSeasons(
  release: Pick<RankedRelease, 'parsed'>,
  kind: 'movie' | 'series',
) {
  if (kind === 'movie')
    return [0]

  return release.parsed.seasons.length ? release.parsed.seasons : [1]
}

/**
 * Серии сезона, которые называет раздача: диапазон из названия, у пака без
 * диапазона — весь сезон по TMDB, а без числа серий — все нужные серии сезона.
 * Окончательно серию подтверждает список файлов.
 */
export function releaseEpisodes(
  release: Pick<RankedRelease, 'parsed'>,
  season: number,
  ctx: Pick<DecideContext, 'kind' | 'episodeCounts' | 'wanted'>,
): EpisodeRef[] {
  if (ctx.kind === 'movie')
    return [{ season: 0, episode: 0 }]

  // Диапазон многосезонного пака бывает и сквозным («Сезон 1-3, Серии 1-60
  // из 60»), и общим на все сезоны: какие серии в каком сезоне, скажут файлы
  const range
    = release.parsed.seasons.length > 1 ? undefined : release.parsed.episodes
  const count = ctx.episodeCounts?.[season]

  if (range || count) {
    const from = range?.from ?? 1
    const to = range?.to ?? count!

    return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => ({
      season,
      episode: from + index,
    }))
  }

  return [...ctx.wanted].flatMap((key) => {
    const [itemSeason, episode] = key.split(':').map(Number)

    return itemSeason === season ? [{ season, episode: episode! }] : []
  })
}

function isFarOutsideCorridor(
  release: RankedRelease,
  kind: 'movie' | 'series',
) {
  const corridor
    = release.resolution && SIZE_CORRIDOR[kind][release.resolution.value]

  if (!corridor || release.episodeSize === undefined)
    return false

  return (
    release.episodeSize < corridor[0] * SIZE_FAR_BELOW
    || release.episodeSize > corridor[1] * SIZE_FAR_ABOVE
  )
}

/** Раздача из темы: адрес страницы у её индексатора тот же */
function isFromTopic(release: RankedRelease, topic: TopicKey | undefined) {
  return (
    !!topic
    && release.indexers.some(
      item =>
        item.id === topic.indexerId && item.detailsUrl === topic.detailsUrl,
    )
  )
}

function hasOwnVoice(release: ReleaseVersion, voice: VoiceRef | undefined) {
  return !!voice && release.voices.some(track => voiceMatches(track, voice))
}

/**
 * Озвучка в cutoff: своя студия сезона; без неё — лучший тип профиля; у
 * тайтла с русским оригиналом — любая.
 */
function isVoiceAtCutoff(
  release: ReleaseVersion,
  season: SeasonContext,
  ctx: Pick<DecideContext, 'russianOriginal' | 'profile'>,
) {
  if (ctx.russianOriginal)
    return true

  if (season.voice)
    return hasOwnVoice(release, season.voice)

  return release.voice?.type === ctx.profile.voiceTypes[0]
}

/** Где версия относительно cutoff сезона */
export function positionOf(
  version: ReleaseVersion,
  season: SeasonContext,
  ctx: Pick<DecideContext, 'russianOriginal' | 'profile' | 'preset'>,
): VersionPosition {
  return {
    voiceAtCutoff: isVoiceAtCutoff(version, season, ctx),
    step:
      ladderStep(version.resolution?.value, ctx.preset)
      ?? Number.POSITIVE_INFINITY,
  }
}

export function isAtCutoff(position: VersionPosition, season: SeasonContext) {
  return position.voiceAtCutoff && position.step <= season.cutoffStep
}

/** Почему кандидат не заменит серию в библиотеке; `undefined` — заменит */
function upgradeRejection(
  check: UpgradeCheck,
  candidate: VersionPosition,
  season: SeasonContext,
  ctx: DecideContext,
) {
  if (check.blocked)
    return reject(check.blocked)

  const current = positionOf(check.current!, season, ctx)

  return isAtCutoff(current, season) || !isUpgrade(candidate, current)
    ? reject('not_better')
    : undefined
}

/**
 * Независимые проверки кандидата для сезона. Окно ожидания и «нашли лучше»
 * решает `planSeason`: они зависят от остальных кандидатов и серий.
 */
export function checkCandidate(
  release: RankedRelease,
  season: SeasonContext,
  ctx: DecideContext,
): CheckedCandidate {
  const rejections: Rejection[] = []
  const step = ladderStep(release.resolution?.value, ctx.preset)
  const ownVoice = hasOwnVoice(release, season.voice)
  const voiceAtCutoff = isVoiceAtCutoff(release, season, ctx)
  const position = {
    voiceAtCutoff,
    step: step ?? Number.POSITIVE_INFINITY,
  }
  const named = releaseEpisodes(release, season.season, ctx)
  const episodes: EpisodeRef[] = []
  const upgrades = new Set<string>()
  const considered: EpisodeRef[] = []
  const episodeRejections = new Map<string, Rejection>()
  const blocked = blockedPart(release, ctx.blocked)
  let blockedEpisodes = false

  for (const item of named) {
    const key = episodeKey(item)
    const check = ctx.upgrades?.get(key)

    // Этих серий нет в файлах раздачи: остальные она закрывает
    if (blocked?.has(key)) {
      blockedEpisodes = true

      if (ctx.wanted.has(key) || check) {
        considered.push(item)
        episodeRejections.set(key, reject('blocklisted'))
      }

      continue
    }

    if (ctx.wanted.has(key)) {
      episodes.push(item)
      considered.push(item)
      continue
    }

    if (!check)
      continue

    const rejection = upgradeRejection(check, position, season, ctx)

    considered.push(item)

    if (rejection) {
      episodeRejections.set(key, rejection)
      continue
    }

    episodes.push(item)
    upgrades.add(key)
  }

  if (release.match.confidence !== 'high')
    rejections.push(reject('title_unsure'))

  if (release.parsed.source && SCREEN_COPIES.has(release.parsed.source)) {
    rejections.push(reject('screen_copy'))
  }
  else if (
    ctx.unavailableUntil !== undefined
    && !isDigitalSource(release.parsed.source)
  ) {
    rejections.push(
      reject(
        'not_available',
        ctx.unavailableUntil
          ? { date: ctx.unavailableUntil.toISOString() }
          : undefined,
      ),
    )
  }

  if (ctx.requireRussian && release.voices.length === 0)
    rejections.push(reject('no_russian'))

  if (step === undefined) {
    rejections.push(
      reject(
        'quality',
        release.resolution ? { quality: release.resolution.value } : undefined,
      ),
    )
  }

  if (isFarOutsideCorridor(release, ctx.kind))
    rejections.push(reject('size', { size: release.episodeSize! }))

  if (blocked === null || (blockedEpisodes && episodes.length === 0))
    rejections.push(reject('blocklisted'))

  if (ctx.voiceStrict && season.voice?.studio && !ownVoice)
    rejections.push(reject('voice_strict', { studio: season.voice.studio }))

  if (episodes.length === 0 && !blockedEpisodes) {
    const kept = UPGRADE_REJECTIONS.find(code =>
      [...episodeRejections.values()].some(item => item.code === code),
    )

    rejections.push(
      named.some(item => ctx.downloading.has(episodeKey(item)))
        ? reject('already_downloading')
        : reject(kept ?? 'no_wanted'),
    )
  }

  if (release.seeders <= 0)
    rejections.push(reject('no_seeders'))

  return {
    release,
    step: step ?? Number.POSITIVE_INFINITY,
    ownVoice,
    wantedCount: episodes.length,
    sameTopic: isFromTopic(release, season.topic),
    episodes,
    upgrades,
    considered,
    episodeRejections,
    voiceAtCutoff,
    rejections,
  }
}

export function isPermanentlyRejected(candidate: CheckedCandidate) {
  return candidate.rejections.some(item => item.type === 'permanent')
}

/**
 * Ступень cutoff по качеству: верхняя, а если в сезоне пришло уже три серии и
 * ни один увиденный релиз не был в верхней ступени — лучшая увиденная.
 */
export function cutoffStepOf(
  preset: FollowQualityPreset,
  bestSeen: VideoClass | undefined,
  seenEpisodes: number,
) {
  if (!bestSeen || seenEpisodes < SEEN_FOR_LOWER_CUTOFF)
    return 0

  return ladderStep(bestSeen, preset) ?? 0
}

/** Лучший класс разрешения среди уверенных раздач сезона без экранок */
export function bestQualitySeen(
  releases: RankedRelease[],
  previous: VideoClass | undefined,
) {
  let best = previous

  for (const release of releases) {
    const value = release.resolution?.value

    if (
      !value
      || release.match.confidence !== 'high'
      || (release.parsed.source && SCREEN_COPIES.has(release.parsed.source))
    ) {
      continue
    }

    if (!best || RESOLUTION_RANK[value] > RESOLUTION_RANK[best])
      best = value
  }

  return best
}

export interface PlannedGrab {
  candidate: CheckedCandidate
  episodes: EpisodeRef[]
}

export interface PlannedPending {
  episode: EpisodeRef
  candidate: CheckedCandidate
  until: Date
}

export interface SeasonPlan {
  /** Кандидаты по порядку Р5 с итоговыми отказами */
  candidates: CheckedCandidate[]
  grabs: PlannedGrab[]
  pending: PlannedPending[]
  /** Серии, которые появились впервые в этом прогоне */
  found: Map<string, Date>
}

function waitParams(
  candidate: CheckedCandidate,
  season: SeasonContext,
  ctx: DecideContext,
  until: Date,
) {
  const params: Record<string, string | number> = {
    until: until.toISOString(),
  }

  if (!candidate.voiceAtCutoff) {
    if (season.voice?.studio)
      params.studio = season.voice.studio
    else params.voiceType = season.voice?.type ?? ctx.profile.voiceTypes[0]!
  }

  if (candidate.step > season.cutoffStep)
    params.quality = QUALITY_LADDERS[ctx.preset][season.cutoffStep]!

  return params
}

/**
 * Решение по сезону. Нужные серии покрываются жадно: лучший по порядку Р5
 * кандидат забирает свои серии, остальное — следующие. Кандидат в cutoff
 * качается сразу; ниже cutoff — когда кончилось окно ожидания серии (от её
 * первого появления, таймер не сбрасывается), до этого он отложен. Серию в
 * библиотеке кандидат забирает, только если он лучше её файла на шаг, и
 * заменяет сразу.
 */
export function planSeason(
  releases: RankedRelease[],
  season: SeasonContext,
  ctx: DecideContext,
): SeasonPlan {
  const checked = releases.map(release =>
    checkCandidate(release, season, ctx),
  )
  const found = new Map<string, Date>()

  for (const candidate of checked) {
    // До цифрового релиза фильма окно не начинается: ждать нечего
    if (
      isPermanentlyRejected(candidate)
      || candidate.rejections.some(item => item.code === 'not_available')
    ) {
      continue
    }

    for (const episode of candidate.episodes) {
      const key = episodeKey(episode)

      if (
        !candidate.upgrades.has(key)
        && !ctx.firstSeen.has(key)
        && !found.has(key)
      ) {
        found.set(key, ctx.now)
      }
    }
  }

  const windowEnd = (episode: EpisodeRef) => {
    const key = episodeKey(episode)
    const seen = ctx.firstSeen.get(key) ?? found.get(key) ?? ctx.now

    return new Date(seen.getTime() + ctx.waitHours * HOUR_MS)
  }
  const sorted = [...checked].sort((a, b) =>
    compareCandidates(a, b, ctx.profile, ctx.kind),
  )
  const uncovered = new Set(ctx.wanted)

  for (const [key, check] of ctx.upgrades ?? []) {
    if (check.current)
      uncovered.add(key)
  }

  const grabs: PlannedGrab[] = []
  const pending: PlannedPending[] = []

  for (const candidate of sorted) {
    if (candidate.rejections.length)
      continue

    const claimed = candidate.episodes.filter(item =>
      uncovered.has(episodeKey(item)),
    )

    if (claimed.length === 0) {
      candidate.rejections.push(reject('outranked'))
      continue
    }

    const atCutoff
      = candidate.voiceAtCutoff && candidate.step <= season.cutoffStep
    const ready: EpisodeRef[] = []
    let waitUntil: Date | undefined

    for (const episode of claimed) {
      uncovered.delete(episodeKey(episode))

      const until = windowEnd(episode)

      // Окно серии уже кончилось, поэтому и взяли не cutoff: замена — сразу
      if (
        atCutoff
        || until <= ctx.now
        || candidate.upgrades.has(episodeKey(episode))
      ) {
        ready.push(episode)
        continue
      }

      pending.push({ episode, candidate, until })
      waitUntil = !waitUntil || until < waitUntil ? until : waitUntil
    }

    if (ready.length) {
      grabs.push({ candidate, episodes: ready })
    }
    else if (waitUntil) {
      candidate.rejections.push(
        reject('wait', waitParams(candidate, season, ctx, waitUntil)),
      )
    }
  }

  return { candidates: sorted, grabs, pending, found }
}
