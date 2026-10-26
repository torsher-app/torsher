import type {
  EpisodeFile,
  SourceCandidate,
  TitleFiles,
} from '@torsher/api-client'
import { api } from '../api.ts'
import { episodeCandidates, episodeFileOf } from '../lib/episodes.ts'
import { FILES_POLL_INTERVAL_MS, FILES_POLL_LIMIT_MS } from '../lib/files.ts'
import { noteHasSources } from '../serverSources.ts'

/** Серия сериала; у фильма сезона и серии нет */
export interface EpisodeTarget {
  titleId: string
  season?: number
  episode?: number
}

export type ResolveStep = 'searching' | 'connecting'

export type ResolveOutcome
  = | { kind: 'found', file: EpisodeFile }
  // `noSources` — искать было негде: на сервере нет источников раздач
    | { kind: 'notFound', noSources?: boolean }
    | { kind: 'cancelled' }

export interface ResolveOptions {
  /** Раздача, выбранная зрителем: подключаем её, ждём файлы и дальше не ищем */
  candidateId?: string
  /** Раздачи, где серию ищем первой: та, что смотрят, и раздача сезона */
  torrents?: (string | undefined)[]
  /** Озвучка прошлых серий: раздачи с ней пробуются первыми */
  voiceKey?: string
  cancelled: () => boolean
  onStep?: (step: ResolveStep) => void
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Файл серии в раздаче; ждёт метаданные от пиров, как экран «Файлы» */
async function fileIn(
  target: EpisodeTarget,
  torrentId: string,
  options: ResolveOptions,
  wait: boolean,
): Promise<EpisodeFile | undefined | 'cancelled'> {
  const until = Date.now() + FILES_POLL_LIMIT_MS

  for (;;) {
    if (options.cancelled())
      return 'cancelled'

    let files: TitleFiles

    try {
      files = await api.titles.getTitleFiles(target.titleId, torrentId)
    }
    catch {
      return undefined
    }

    if (options.cancelled())
      return 'cancelled'

    if (files.status === 'ready') {
      const file = episodeFileOf(files.files, target)

      return file ? { torrentId, fileIndex: file.fileIndex } : undefined
    }

    if (!wait || Date.now() >= until)
      return undefined

    await sleep(FILES_POLL_INTERVAL_MS)
  }
}

/**
 * Раздача, которую «Следить» выбрал для серии в режиме «Только уведомлять».
 * Выбора нет или раздачу не добавить — `undefined`, дальше обычный автовыбор
 */
async function pickedFile(target: EpisodeTarget, options: ResolveOptions) {
  let torrentId

  try {
    torrentId = (
      await api.titles.openFollowPick(target.titleId, {
        season: target.season ?? 0,
        episode: target.episode ?? 0,
      })
    ).torrentId
  }
  catch {
    return undefined
  }

  options.onStep?.('connecting')

  return fileIn(target, torrentId, options, true)
}

/**
 * Файл серии: сначала в уже известных раздачах (та, что смотрят, и раздача
 * сезона — выбор зрителя сильнее), потом в раздаче, которую выбрал «Следить»,
 * потом в лучших раздачах тайтла, где эта серия есть, — с той же озвучкой
 * первыми. Каждую раздачу подключаем и ждём её файлы.
 */
export async function resolveEpisode(
  target: EpisodeTarget,
  options: ResolveOptions,
): Promise<ResolveOutcome> {
  const known = [...new Set(options.torrents?.filter(Boolean) as string[])]

  if (options.candidateId)
    return openAndFind(target, options.candidateId, options)

  options.onStep?.('searching')

  for (const torrentId of known) {
    const found = await fileIn(target, torrentId, options, false)

    if (found === 'cancelled')
      return { kind: 'cancelled' }

    if (found)
      return { kind: 'found', file: found }
  }

  const picked = await pickedFile(target, options)

  if (picked === 'cancelled')
    return { kind: 'cancelled' }

  if (picked)
    return { kind: 'found', file: picked }

  let candidates: SourceCandidate[] = []
  // Спрашиваем сервер и без источников по общему признаку: индексатор могли
  // подключить, пока витрина открыта, а без индексаторов поиск мгновенный
  let noSources = false

  try {
    const sources = await api.titles.getTitleSources(target.titleId, {
      all: '1',
    })

    noSources = sources.indexers.total === 0
    noteHasSources(!noSources)

    if (target.season !== undefined && target.episode !== undefined) {
      candidates = episodeCandidates(
        sources.candidates,
        { season: target.season, episode: target.episode },
        options.voiceKey,
      )
    }
  }
  catch {
    // Поиск не ответил: ищем только в известных раздачах
  }

  for (const candidate of candidates) {
    const outcome = await openAndFind(target, candidate.id, options)

    if (outcome.kind !== 'notFound')
      return outcome
  }

  return options.cancelled()
    ? { kind: 'cancelled' }
    : { kind: 'notFound', noSources }
}

/** Подключает раздачу кандидата и ждёт в ней файл серии */
async function openAndFind(
  target: EpisodeTarget,
  candidateId: string,
  options: ResolveOptions,
): Promise<ResolveOutcome> {
  if (options.cancelled())
    return { kind: 'cancelled' }

  options.onStep?.('connecting')

  let torrentId

  try {
    torrentId = (
      await api.titles.postTitleOpen(target.titleId, { candidateId })
    ).torrentId
  }
  catch {
    return options.cancelled() ? { kind: 'cancelled' } : { kind: 'notFound' }
  }

  const found = await fileIn(target, torrentId, options, true)

  if (found === 'cancelled')
    return { kind: 'cancelled' }

  return found ? { kind: 'found', file: found } : { kind: 'notFound' }
}
