import type {
  SeasonRelease,
  SourceCandidate,
  TitleFile,
} from '@torsher/api-client'

// Больше раздач не пробуем: каждая — подключение к пирам и ожидание файлов
export const EPISODE_ATTEMPTS = 3

/** Ключ озвучки как у сервера (`voiceKeys` кандидата) */
export function voiceKeyOf(voice: { studio?: string, type?: string }) {
  return voice.studio ? `studio:${voice.studio}` : `type:${voice.type ?? 'ru'}`
}

/** Есть ли в раздаче эта серия: сезон и диапазон серий, пак — весь сезон */
export function coversEpisode(
  candidate: Pick<SourceCandidate, 'seasons' | 'episodes'>,
  season: number,
  episode: number,
) {
  if (!candidate.seasons.includes(season))
    return false

  const range = candidate.episodes

  return !range || (episode >= range.from && episode <= range.to)
}

/**
 * Озвучка, которой смотрели: раздача этого сезона, иначе ближайшего прошлого
 * — новый сезон продолжается той же студией
 */
export function lastVoiceKey(releases: SeasonRelease[], season: number) {
  const release = releases
    .filter(item => item.season <= season && item.voice)
    .sort((a, b) => b.season - a.season)[0]

  return release?.voice ? voiceKeyOf(release.voice) : undefined
}

/**
 * Раздачи, в которых есть серия: сначала с той же озвучкой, дальше порядок
 * сервера (ранжирование по профилю); не больше `EPISODE_ATTEMPTS`
 */
export function episodeCandidates(
  candidates: SourceCandidate[],
  target: { season: number, episode: number },
  voiceKey?: string,
) {
  const covering = candidates.filter(
    item =>
      item.confidence === 'high'
      && coversEpisode(item, target.season, target.episode),
  )
  const sameVoice = voiceKey
    ? covering.filter(item => item.voiceKeys.includes(voiceKey))
    : []
  const rest = covering.filter(item => !sameVoice.includes(item))

  return [...sameVoice, ...rest].slice(0, EPISODE_ATTEMPTS)
}

/** Файл серии среди файлов раздачи; у фильма — самое большое видео */
export function episodeFileOf(
  files: Pick<TitleFile, 'fileIndex' | 'season' | 'episode' | 'size'>[],
  target: { season?: number, episode?: number },
) {
  if (target.season === undefined || target.episode === undefined) {
    return files.reduce<(typeof files)[number] | undefined>(
      (best, file) => (!best || file.size > best.size ? file : best),
      undefined,
    )
  }

  return files.find(
    file => file.season === target.season && file.episode === target.episode,
  )
}
