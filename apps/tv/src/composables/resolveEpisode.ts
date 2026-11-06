import type {
  DiagnosticContext,
  DiagnosticInput,
} from '../diagnostics/index.ts'
import {
  diagnostic,
  diagnosticAction,
  diagnosticParams,
  diagnosticPoll,
} from '../diagnostics/index.ts'
import type {
  EpisodeFile,
  OpenFollowPickError,
  SourceCandidate,
  TitleFiles,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { api } from '../api.ts'
import { session } from '../session.ts'
import { selectedSourcePreset, sourcePresetStore } from '../sourcePreset.ts'
import {
  coversEpisode,
  episodeCandidates,
  episodeFileOf,
} from '../lib/episodes.ts'
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
    | {
      kind: 'notFound'
      noSources?: boolean
      failureKind?: 'unsuitable' | 'searchFailed'
    }
    | { kind: 'cancelled' }
    | { kind: 'followUnavailable' | 'followOpenFailed' | 'followUnsupported' }

export interface ResolveOptions {
  intent?: 'follow-ready'
  diagnosticContext?: DiagnosticContext
  diagnosticBranch?: Extract<
    DiagnosticInput,
    { event: 'source.resolve' | 'source.attempt' | 'source.selected' }
  >['branch']
  attemptIndex?: number
  presetId?: string
  /** Раздача, выбранная зрителем: подключаем её, ждём файлы и дальше не ищем */
  candidateId?: string
  /** Уточнённый поисковый запрос, из которого выбран кандидат. */
  query?: string
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
function report(
  options: ResolveOptions,
  target: EpisodeTarget,
  event: 'source.resolve' | 'source.attempt' | 'source.selected',
  outcome: Extract<
    DiagnosticInput,
    { event: 'source.resolve' | 'source.attempt' | 'source.selected' }
  >['outcome'],
  file?: EpisodeFile,
) {
  diagnostic(
    {
      event,
      ...target,
      ...file,
      branch: options.diagnosticBranch ?? 'known_torrent',
      outcome,
      candidateId: options.candidateId,
      attemptIndex: options.attemptIndex,
      presetId: options.presetId,
    },
    options.diagnosticContext,
  )
}
async function fileIn(
  target: EpisodeTarget,
  torrentId: string,
  options: ResolveOptions,
  wait: boolean,
): Promise<EpisodeFile | undefined | 'cancelled'> {
  if (!options.candidateId) {
    diagnostic(
      {
        event: 'source.attempt',
        ...target,
        torrentId,
        branch: options.diagnosticBranch ?? 'known_torrent',
        outcome: 'resolving',
        candidateId: options.candidateId,
        attemptIndex: options.attemptIndex,
      },
      options.diagnosticContext,
    )
  }
  const poll = diagnosticPoll(
    'files',
    { ...target, torrentId },
    options.diagnosticContext ?? {},
  )
  let pollOutcome: 'accepted' | 'failed' | 'cancelled' | 'timeout' = 'failed'
  try {
    const until = Date.now() + FILES_POLL_LIMIT_MS

    for (;;) {
      if (options.cancelled()) {
        report(options, target, 'source.attempt', 'cancelled')
        pollOutcome = 'cancelled'
        return 'cancelled'
      }

      let files: TitleFiles

      try {
        files = await api.titles.getTitleFiles(
          target.titleId,
          torrentId,
          poll.params(),
        )
      }
      catch {
        report(options, target, 'source.attempt', 'search_failed')
        return undefined
      }

      if (options.cancelled()) {
        report(options, target, 'source.attempt', 'cancelled')
        pollOutcome = 'cancelled'
        return 'cancelled'
      }

      if (files.status === 'ready') {
        const file = episodeFileOf(files.files, target)

        report(
          options,
          target,
          file ? 'source.selected' : 'source.attempt',
          file ? 'file_found' : 'episode_absent',
          file ? { torrentId, fileIndex: file.fileIndex } : undefined,
        )
        pollOutcome = 'accepted'
        return file ? { torrentId, fileIndex: file.fileIndex } : undefined
      }

      if (!wait || Date.now() >= until) {
        pollOutcome = wait ? 'timeout' : 'accepted'
        report(
          options,
          target,
          'source.attempt',
          wait ? 'metadata_timeout' : 'episode_absent',
        )
        return undefined
      }

      await sleep(FILES_POLL_INTERVAL_MS)
    }
  }
  finally {
    poll.finish(options.cancelled() ? 'cancelled' : pollOutcome)
  }
}

/**
 * Раздача, которую «Следить» выбрал для серии в режиме «Только уведомлять».
 * Выбора нет или раздачу не добавить — `undefined`, дальше обычный автовыбор
 */
async function pickedFile(target: EpisodeTarget, options: ResolveOptions) {
  let torrentId
  report(options, target, 'source.attempt', 'resolving')

  try {
    torrentId = (
      await api.titles.openFollowPick(
        target.titleId,
        {
          season: target.season ?? 0,
          episode: target.episode ?? 0,
          ...(options.intent ? { intent: options.intent } : {}),
        },
        diagnosticParams(options.diagnosticContext),
      )
    ).torrentId
  }
  catch (error) {
    if (options.intent === 'follow-ready')
      throw error
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
  options = {
    ...options,
    diagnosticContext: options.diagnosticContext ?? diagnosticAction(),
  }
  report(
    { ...options, diagnosticBranch: 'requested' },
    target,
    'source.resolve',
    'resolving',
  )
  if (options.intent === 'follow-ready') {
    if (options.cancelled())
      return { kind: 'cancelled' }
    try {
      const picked = await pickedFile(target, options)
      if (options.cancelled() || picked === 'cancelled')
        return { kind: 'cancelled' }
      return picked
        ? { kind: 'found', file: picked }
        : { kind: 'followOpenFailed' }
    }
    catch (error) {
      if (options.cancelled())
        return { kind: 'cancelled' }
      const status = getErrorStatus(error)
      if (status === 409) {
        const body = await getErrorBody<OpenFollowPickError>(error)
        if (body && 'kind' in body && body.kind === 'follow_pick_unavailable')
          return { kind: 'followUnavailable' }
      }
      return {
        kind: status === 404 ? 'followUnsupported' : 'followOpenFailed',
      }
    }
  }
  const known = [...new Set(options.torrents?.filter(Boolean) as string[])]

  if (options.candidateId) {
    return openAndFind(target, options.candidateId, {
      ...options,
      diagnosticBranch: 'requested',
    })
  }

  options.onStep?.('searching')

  for (const torrentId of known) {
    const found = await fileIn(target, torrentId, options, false)

    if (found === 'cancelled')
      return { kind: 'cancelled' }

    if (found)
      return { kind: 'found', file: found }
  }

  const picked = await pickedFile(target, {
    ...options,
    diagnosticBranch: 'follow_pick',
  })

  if (picked === 'cancelled')
    return { kind: 'cancelled' }

  if (picked)
    return { kind: 'found', file: picked }

  let candidates: SourceCandidate[] = []
  // Спрашиваем сервер и без источников по общему признаку: индексатор могли
  // подключить, пока витрина открыта, а без индексаторов поиск мгновенный
  let noSources = false
  let searched = false
  let unsuitable = false

  try {
    const profileId = session.profile?.id
    const presetId = options.presetId ?? selectedSourcePreset.value
    const sources = await api.titles.getTitleSources(
      target.titleId,
      {
        all: '1',
        presetId,
      },
      diagnosticParams(options.diagnosticContext),
    )
    options = {
      ...options,
      presetId,
      diagnosticContext: {
        ...options.diagnosticContext,
        rankingDecisionId: sources.rankingDecisionId,
      },
    }
    searched = true
    sourcePresetStore.reconcile(profileId, presetId, sources.presets)

    noSources = sources.indexers.total === 0
    noteHasSources(!noSources)

    if (target.season !== undefined && target.episode !== undefined) {
      candidates = episodeCandidates(
        sources.candidates,
        { season: target.season, episode: target.episode },
        options.voiceKey,
      )
      unsuitable
        = candidates.length === 0
          && sources.candidates.some(item =>
            coversEpisode(item, target.season!, target.episode!),
          )
    }
  }
  catch {
    report(options, target, 'source.resolve', 'search_failed')
    // Поиск не ответил: ищем только в известных раздачах
  }

  if (searched) {
    diagnostic(
      {
        event: 'source.resolve',
        ...target,
        branch: 'ranked_candidate',
        outcome: 'ready',
        presetId: options.presetId,
        rankingApplied: true,
        eligible: candidates.length,
        candidates: candidates.map(candidate => ({
          candidateId: candidate.id,
          diagnostics: candidate.diagnostics,
          confidence: candidate.confidence,
          seeders: candidate.seeders,
          quality: candidate.quality,
          resolution: candidate.resolution,
          coversEpisode: true,
        })),
      },
      options.diagnosticContext,
    )
  }
  for (const [attemptIndex, candidate] of candidates.entries()) {
    const outcome = await openAndFind(target, candidate.id, {
      ...options,
      diagnosticBranch: 'ranked_candidate',
      candidateId: candidate.id,
      attemptIndex,
    })

    if (outcome.kind !== 'notFound')
      return outcome
  }

  return options.cancelled()
    ? { kind: 'cancelled' }
    : {
        kind: 'notFound',
        noSources,
        ...(!searched
          ? { failureKind: 'searchFailed' as const }
          : unsuitable
            ? { failureKind: 'unsuitable' as const }
            : {}),
      }
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
  report(options, target, 'source.attempt', 'resolving')

  let torrentId

  try {
    torrentId = (
      await api.titles.postTitleOpen(
        target.titleId,
        { candidateId, query: options.query },
        diagnosticParams(options.diagnosticContext),
      )
    ).torrentId
  }
  catch {
    report(
      options,
      target,
      'source.attempt',
      options.cancelled() ? 'cancelled' : 'open_rejected',
    )
    return options.cancelled() ? { kind: 'cancelled' } : { kind: 'notFound' }
  }

  const found = await fileIn(target, torrentId, options, true)

  if (found === 'cancelled')
    return { kind: 'cancelled' }

  return found ? { kind: 'found', file: found } : { kind: 'notFound' }
}
