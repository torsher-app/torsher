import type { VideoClass } from '@torsher/release-parser'
import type { FollowQualityPreset } from '../../db/schema.ts'
import type { RankingProfile } from '../sources/profile.ts'
import type { RankedRelease } from '../sources/rank.ts'
import { SIZE_CORRIDOR, voiceRank } from '../sources/rank.ts'

/** Лестницы пресетов: первое — верхняя ступень */
export const QUALITY_LADDERS: Record<FollowQualityPreset, VideoClass[]> = {
  best: ['1080p', '720p', 'SD'],
  uhd: ['2160p', '1080p', '720p'],
  compact: ['720p', 'SD'],
}

/**
 * Ступень раздачи в лестнице, 0 — верхняя. Разрешение не узнать — ступень ниже
 * последней, если в лестнице есть SD; вне лестницы — `undefined`.
 */
export function ladderStep(
  resolution: VideoClass | undefined,
  preset: FollowQualityPreset,
) {
  const ladder = QUALITY_LADDERS[preset]

  if (!resolution)
    return ladder.includes('SD') ? ladder.length : undefined

  const index = ladder.indexOf(resolution)

  return index === -1 ? undefined : index
}

/** Кандидат после проверок: всё, по чему его сравнивают */
export interface OrderedCandidate {
  release: RankedRelease
  step: number
  /** Своя студия сезона среди дорожек */
  ownVoice: boolean
  /** Сколько нужных серий раздача закрывает */
  wantedCount: number
}

function seedersBucket(seeders: number) {
  return Math.round(Math.log10(seeders + 1))
}

/** Насколько размер на серию далёк от середины коридора; без коридора — дальше всех */
function sizeDistance(release: RankedRelease, kind: 'movie' | 'series') {
  const corridor
    = release.resolution && SIZE_CORRIDOR[kind][release.resolution.value]

  if (!corridor || release.episodeSize === undefined)
    return Number.POSITIVE_INFINITY

  const middle = (corridor[0] + corridor[1]) / 2

  return Math.abs(release.episodeSize - middle) / middle
}

/**
 * Порядок кандидатов «Следить»: своя студия, ступень лестницы (внутри неё
 * точное разрешение выше выведенного), тип озвучки, число нужных серий, сиды
 * по порядку величины, размер ближе к середине коридора, счёт ранжирования.
 * Озвучка раньше качества: для русского зрителя она важнее.
 */
export function compareCandidates(
  a: OrderedCandidate,
  b: OrderedCandidate,
  profile: RankingProfile,
  kind: 'movie' | 'series',
) {
  const voice = (item: OrderedCandidate) =>
    item.release.voice
      ? voiceRank(item.release.voice, profile)
      : profile.voiceTypes.length + 1

  return (
    Number(b.ownVoice) - Number(a.ownVoice)
    || a.step - b.step
    || Number(!!b.release.resolution?.sure)
    - Number(!!a.release.resolution?.sure)
    || voice(a) - voice(b)
    || b.wantedCount - a.wantedCount
    || seedersBucket(b.release.seeders) - seedersBucket(a.release.seeders)
    || sizeDistance(a.release, kind) - sizeDistance(b.release, kind)
    || b.release.score - a.release.score
    || a.release.id.localeCompare(b.release.id)
  )
}
