import type {
  AudioTrack,
  ParsedRelease,
  TitleMatch,
  VideoClass,
  VideoResolution,
} from '@torsher/release-parser'
import type { RankingProfile, VoiceRef } from './profile.ts'
import { videoResolution } from '@torsher/release-parser'

/** Раздача после поиска, склейки повторов и матчера; `low` сюда не попадает */
export interface FoundRelease {
  /** Стабильный между поисками: по infohash, без него — по названию и размеру. */
  id: string
  title: string
  indexers: { id: string, name: string }[]
  /** Ссылка на `.torrent` у индексатора — только на сервере: в ней бывает ключ. */
  link?: { url: string, indexerId: string }
  magnet?: string
  infoHash?: string
  size?: number
  seeders: number
  peers?: number
  publishedAt?: Date
  parsed: ParsedRelease
  match: TitleMatch
}

/**
 * Почему кандидат в тройке: `pinnedVoice` — «Как в прошлых сериях»,
 * `profile` — лучший по профилю, `bestQuality` — качество выше лучшего,
 * `smaller` — заметно меньше размер, `moreSeeders` — заметно больше сидов,
 * `originalAudio` — есть оригинальная дорожка.
 */
export type SourceReason
  = | 'pinnedVoice'
    | 'profile'
    | 'bestQuality'
    | 'smaller'
    | 'moreSeeders'
    | 'originalAudio'

export interface RankedRelease extends FoundRelease {
  score: number
  /** Основная русская дорожка или русский оригинал (`voiceOf`). */
  voice?: AudioTrack
  /** Все русские дорожки (`russianVoices`): основная среди них. */
  voices: AudioTrack[]
  /** Разрешение: проба или файлы добавленной раздачи, иначе по названию. */
  resolution?: VideoResolution
  /** Размер на серию у сериала; у фильма — весь размер. */
  episodeSize?: number
  /** Годится в тройку: уверенный матч, есть сиды, не экранная копия. */
  eligible: boolean
  reason?: SourceReason
}

export interface RankContext {
  kind: 'movie' | 'series'
  profile: RankingProfile
  pinned?: VoiceRef
  /** Язык оригинала тайтла, ISO 639-1. */
  originalLanguage?: string
  /** Серий в сезонах по TMDB: размер на серию у пака без диапазона. */
  episodeCounts?: Record<number, number>
  /** Точные разрешения раздач, которые уже добавляли (`knownResolutions`), по ID. */
  known?: Map<string, VideoResolution>
  /**
   * Сезон, который смотрят, при раздачах всех сезонов: тройка — из раздач с
   * ним, а без таких — из всех. Пак одного третьего сезона зрителю первого не
   * советуем.
   */
  focusSeason?: number
}

export const TOP_SIZE = 3

const GB = 1024 ** 3

// Чем выше разрешение, тем больше число: для «Лучшее качество»
export const RESOLUTION_RANK: Record<VideoClass, number> = {
  '2160p': 4,
  '1080p': 3,
  '720p': 2,
  'SD': 1,
}

// Разумный размер на фильм и на серию: всё, что вне, — подозрительно
const SIZE_CORRIDOR: Record<
  'movie' | 'series',
  Partial<Record<VideoClass, [number, number]>>
> = {
  movie: {
    '720p': [0.7 * GB, 8 * GB],
    '1080p': [1.4 * GB, 30 * GB],
    '2160p': [4 * GB, 80 * GB],
  },
  series: {
    '720p': [0.15 * GB, 2.5 * GB],
    '1080p': [0.3 * GB, 6 * GB],
    '2160p': [1 * GB, 20 * GB],
  },
}

const SCREEN_COPIES = new Set(['CAMRip', 'TS'])

/** Веса факторов счёта: качество, озвучка, сиды и размер складываются */
export const WEIGHTS = {
  qualityLadder: [40, 30, 20],
  qualityOther: 8,
  qualityUnknown: 5,
  // Разрешение выведено, а не написано: при прочих равных точное выше
  qualityInferred: -5,
  screenCopy: -60,
  // Закреплённая студия перевешивает и лучший тип перевода, и ступень качества
  pinnedVoice: 80,
  russianUntyped: 10,
  voiceTypes: [30, 25, 20, 15, 12, 8],
  seedersMax: 30,
  seedersPerDecade: 12,
  noSeeders: -100,
  sizeTooSmall: -15,
  sizeTooBig: -10,
  mediumMatch: -40,
  torrentFile: 3,
}

/** Русская дорожка: язык `ru` или тип и студия без явного другого языка */
function isRussian(track: AudioTrack) {
  if (track.type === 'Original')
    return false

  return track.language
    ? track.language === 'ru'
    : !!(track.type || track.studio)
}

function voiceRank(track: AudioTrack, profile: RankingProfile) {
  const index = track.type ? profile.voiceTypes.indexOf(track.type) : -1

  return index === -1 ? profile.voiceTypes.length : index
}

// Русский оригинал в названиях раздач не пишут: дорожка не указана — значит, она одна
const RUSSIAN_ORIGINAL: AudioTrack = { type: 'Original', language: 'ru' }

/**
 * Все русские дорожки раздачи по профилю, а у тайтла с русским оригиналом без
 * дорожек в названии — оригинал. По ним раздача попадает в фильтры озвучки.
 */
export function russianVoices(parsed: ParsedRelease, ctx: RankContext) {
  if (parsed.audio.length === 0 && ctx.originalLanguage === 'ru')
    return [RUSSIAN_ORIGINAL]

  return parsed.audio
    .filter(isRussian)
    .sort((a, b) => voiceRank(a, ctx.profile) - voiceRank(b, ctx.profile))
}

/** Основная дорожка: закреплённая, если она в раздаче есть, иначе лучшая по профилю */
export function voiceOf(voices: AudioTrack[], ctx: RankContext) {
  const pinned = ctx.pinned
    ? voices.find(track => voiceMatches(track, ctx.pinned!))
    : undefined

  return pinned ?? voices[0]
}

function hasOriginalAudio(parsed: ParsedRelease) {
  return parsed.audio.some(
    track =>
      track.type === 'Original'
      || (!!track.language && track.language !== 'ru'),
  )
}

export function voiceMatches(track: AudioTrack | undefined, pinned: VoiceRef) {
  if (!track)
    return false

  if (pinned.studio)
    return track.studio?.toLowerCase() === pinned.studio.toLowerCase()

  return !!pinned.type && !track.studio && track.type === pinned.type
}

/**
 * Сколько серий в раздаче: диапазон из названия, а у пака без диапазона
 * (`[S01]`, `[S01-05]`) — серии его сезонов по TMDB, если TMDB знает их все.
 * У идущего сезона TMDB знает и невышедшие серии, поэтому размер на серию
 * будет занижен: это ориентир.
 */
function episodeCountOf(
  parsed: ParsedRelease,
  episodeCounts?: Record<number, number>,
) {
  const { episodes, seasons } = parsed

  if (episodes)
    return episodes.to - episodes.from + 1

  if (!parsed.isPack || seasons.length === 0 || !episodeCounts)
    return undefined

  const counts = seasons.map(season => episodeCounts[season])

  return counts.every(count => !!count)
    ? counts.reduce((sum, count) => sum + count, 0)
    : undefined
}

export function episodeSizeOf(
  release: FoundRelease,
  kind: 'movie' | 'series',
  episodeCounts?: Record<number, number>,
) {
  if (release.size === undefined)
    return undefined

  if (kind === 'movie')
    return release.size

  const count = episodeCountOf(release.parsed, episodeCounts)

  return count ? Math.round(release.size / count) : undefined
}

/**
 * Есть ли в раздаче серия: сезон проверил матчер, здесь — диапазон серий.
 * Пак без диапазона считается полным сезоном; окончательно серию
 * подтверждает список файлов.
 */
export function coversEpisode(parsed: ParsedRelease, episode: number) {
  const range = parsed.episodes

  if (!range)
    return true

  return episode >= range.from && episode <= range.to
}

function qualityScore(
  parsed: ParsedRelease,
  resolution: VideoResolution | undefined,
  profile: RankingProfile,
) {
  if (parsed.source && SCREEN_COPIES.has(parsed.source))
    return WEIGHTS.screenCopy

  if (!resolution)
    return WEIGHTS.qualityUnknown

  const index = profile.qualities.indexOf(resolution.value)
  const score
    = index === -1
      ? WEIGHTS.qualityOther
      : (WEIGHTS.qualityLadder[index] ?? WEIGHTS.qualityOther)

  return resolution.sure ? score : score + WEIGHTS.qualityInferred
}

function voiceScore(voice: AudioTrack | undefined, ctx: RankContext) {
  if (!voice)
    return 0

  if (ctx.pinned && voiceMatches(voice, ctx.pinned))
    return WEIGHTS.pinnedVoice

  const index = voice.type ? ctx.profile.voiceTypes.indexOf(voice.type) : -1

  return index === -1
    ? WEIGHTS.russianUntyped
    : (WEIGHTS.voiceTypes[index] ?? WEIGHTS.russianUntyped)
}

function seedersScore(seeders: number) {
  if (seeders <= 0)
    return WEIGHTS.noSeeders

  return Math.min(
    WEIGHTS.seedersMax,
    Math.log10(seeders + 1) * WEIGHTS.seedersPerDecade,
  )
}

function sizeScore(
  resolution: VideoResolution | undefined,
  episodeSize: number | undefined,
  kind: 'movie' | 'series',
) {
  const corridor = resolution && SIZE_CORRIDOR[kind][resolution.value]

  if (!corridor || episodeSize === undefined)
    return 0

  if (episodeSize < corridor[0])
    return WEIGHTS.sizeTooSmall

  return episodeSize > corridor[1] ? WEIGHTS.sizeTooBig : 0
}

function scoreOf(
  release: FoundRelease,
  voice: AudioTrack | undefined,
  episodeSize: number | undefined,
  resolution: VideoResolution | undefined,
  ctx: RankContext,
) {
  return (
    qualityScore(release.parsed, resolution, ctx.profile)
    + voiceScore(voice, ctx)
    + seedersScore(release.seeders)
    + sizeScore(resolution, episodeSize, ctx.kind)
    + (release.match.confidence === 'medium' ? WEIGHTS.mediumMatch : 0)
    + (release.link ? WEIGHTS.torrentFile : 0)
  )
}

function resolutionRank(release: RankedRelease) {
  // Выведенное разрешение — не повод советовать раздачу как лучшую по качеству
  const base = release.resolution?.sure
    ? RESOLUTION_RANK[release.resolution.value]
    : 0

  // HDR и DV при том же разрешении — тоже лучше
  return base * 2 + (release.parsed.hdr.length > 0 ? 1 : 0)
}

function compareRanked(a: RankedRelease, b: RankedRelease) {
  return b.score - a.score || b.seeders - a.seeders || a.id.localeCompare(b.id)
}

/**
 * Тройка с причиной: лучший по профилю, лучший по качеству,
 * если он другой, и самый лёгкий для старта; где различий нет — следующий
 * по счёту без причины.
 */
function pickTop(eligible: RankedRelease[], ctx: RankContext) {
  const best = eligible[0]

  if (!best)
    return []

  const top: RankedRelease[] = [
    {
      ...best,
      reason:
        ctx.pinned && voiceMatches(best.voice, ctx.pinned)
          ? 'pinnedVoice'
          : 'profile',
    },
  ]
  const rest = () =>
    eligible.filter(item => !top.some(t => t.id === item.id))
  const bestRank = resolutionRank(best)
  const quality = rest()
    .filter(item => resolutionRank(item) > bestRank)
    .sort(
      (a, b) => resolutionRank(b) - resolutionRank(a) || compareRanked(a, b),
    )[0]

  if (quality)
    top.push({ ...quality, reason: 'bestQuality' })

  const bestSize = best.episodeSize
  const smaller = bestSize
    ? rest()
      .filter(
        item =>
          item.episodeSize !== undefined
          && item.episodeSize < bestSize * 0.6
          && item.seeders >= 3,
      )
      .sort((a, b) => a.episodeSize! - b.episodeSize!)[0]
    : undefined
  const seeded = rest()
    .filter(item => item.seeders > Math.max(best.seeders * 2, 10))
    .sort((a, b) => b.seeders - a.seeders)[0]
  const original = hasOriginalAudio(best.parsed)
    ? undefined
    : rest().find(item => hasOriginalAudio(item.parsed))

  if (smaller)
    top.push({ ...smaller, reason: 'smaller' })
  else if (seeded)
    top.push({ ...seeded, reason: 'moreSeeders' })
  else if (original)
    top.push({ ...original, reason: 'originalAudio' })

  for (const item of rest()) {
    if (top.length >= TOP_SIZE)
      break

    top.push(item)
  }

  return top.slice(0, TOP_SIZE)
}

export interface Ranking {
  /** Все кандидаты по убыванию счёта; у вошедших в тройку — причина. */
  ranked: RankedRelease[]
  /** ID тройки по порядку показа. */
  top: string[]
}

/**
 * Счёт по профилю и тройка с причинами. В тройку идут только уверенные
 * совпадения с сидами и с русской дорожкой; если с дорожкой нет ни одной —
 * без неё (откат, а не пустой экран).
 */
export function rankReleases(
  releases: FoundRelease[],
  ctx: RankContext,
): Ranking {
  const ranked = releases
    .map((release) => {
      const voices = russianVoices(release.parsed, ctx)
      const voice = voiceOf(voices, ctx)
      const episodeSize = episodeSizeOf(release, ctx.kind, ctx.episodeCounts)
      const resolution
        = ctx.known?.get(release.id) ?? videoResolution(release.parsed)
      const screenCopy
        = !!release.parsed.source && SCREEN_COPIES.has(release.parsed.source)

      return {
        ...release,
        voice,
        voices,
        episodeSize,
        resolution,
        score: scoreOf(release, voice, episodeSize, resolution, ctx),
        eligible:
          release.match.confidence === 'high'
          && release.seeders > 0
          && !screenCopy,
      }
    })
    .sort(compareRanked)

  const focus = ctx.focusSeason
  const allEligible = ranked.filter(item => item.eligible)
  const inSeason
    = focus === undefined
      ? allEligible
      : allEligible.filter(item => item.parsed.seasons.includes(focus))
  const eligible = inSeason.length > 0 ? inSeason : allEligible
  const voiced = eligible.filter(item => item.voice)
  const top = pickTop(voiced.length > 0 ? voiced : eligible, ctx)
  const reasons = new Map(top.map(item => [item.id, item.reason]))

  return {
    ranked: ranked.map(item =>
      reasons.has(item.id) ? { ...item, reason: reasons.get(item.id) } : item,
    ),
    top: top.map(item => item.id),
  }
}
