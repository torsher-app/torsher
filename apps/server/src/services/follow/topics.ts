import type { ParsedRelease, VideoClass } from '@torsher/release-parser'
import type {
  Follow,
  FollowPendingCandidate,
  TopicRefresh,
  Torrent,
  TrackedTopic,
} from '../../db/schema.ts'
import type { FoundRelease } from '../sources/rank.ts'
import type { GrabResult } from './grab.ts'
import type { EpisodeRef } from './wanted.ts'
import { join, resolve } from 'node:path'
import { parseRelease, videoResolution } from '@torsher/release-parser'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  followEpisodes,
  followSeasons,
  indexers,
  torrents,
  trackedTopics,
} from '../../db/schema.ts'
import { EngineError, isEngineReady } from '../engine/index.ts'
import { relinkMediaFiles, torrentLibraryFiles } from '../library/files.ts'
import { syncLibrary } from '../library/linker.ts'
import { logFor } from '../logs/index.ts'
import { relinkTitleProgress } from '../sources/progress.ts'
import { ensureSpaceFor, InsufficientStorageError } from '../storage/index.ts'
import { isMovingTorrent } from '../storage/moving.ts'
import { torrentDir } from '../storage/paths.ts'
import { isStreaming } from '../storage/streams.ts'
import { downloadFiles, getTorrent } from '../torrents/index.ts'
import {
  carryMap,
  compareOnDisk,
  diskPathOf,
  forgetKeepingFiles,
  linkCarried,
  moveWatchStates,
  NoLinkError,
  removeFiles,
  unlinkCarried,
} from '../torrents/refresh.ts'
import {
  blockTorrent,
  filesFor,
  resetEpisodes,
  retryLater,
  startGrab,
  updateEpisodes,
} from './grab.ts'
import { recordHistory } from './history.ts'
import { followById } from './index.ts'
import { episodeKey } from './wanted.ts'

// Сверка читает сезон целиком: после сбоя движка или диска подмена ждёт, а
// не повторяется на каждом тике
const RETRY_MS = 15 * 60 * 1000

export interface TopicKey {
  indexerId: string
  detailsUrl: string
}

/** Что в названии раздачи темы сравнивается с её новой версией */
interface TopicShape {
  season: number
  studio?: string
  quality?: VideoClass
  /** Конец диапазона серий; нет — пак на весь сезон */
  to?: number
  total?: number
}

/**
 * Обновляемая тема — пак одного сезона («Серии 1–8 из 12», весь сезон).
 * Раздача на одну серию темой не считается: её новая версия — другая серия.
 */
export function isTopicRelease(parsed: ParsedRelease) {
  return (
    parsed.kind === 'series'
    && parsed.seasons.length <= 1
    && (parsed.isPack || !!parsed.episodes?.total)
  )
}

export function topicShape(title: string): TopicShape | undefined {
  const parsed = parseRelease(title)

  if (!isTopicRelease(parsed))
    return undefined

  return {
    season: parsed.seasons[0] ?? 1,
    studio: parsed.audio.find(track => track.studio)?.studio?.toLowerCase(),
    quality: videoResolution(parsed)?.value,
    to: parsed.episodes?.to,
    total: parsed.episodes?.total,
  }
}

/**
 * Новая версия той же темы, а не другой релиз: тот же сезон, та же студия и
 * то же качество, серий не меньше. Иначе это обычный кандидат.
 */
export function isTopicUpdate(previous: string, next: string) {
  const before = topicShape(previous)
  const after = topicShape(next)

  if (!before || !after)
    return false

  return (
    before.season === after.season
    && before.studio === after.studio
    && before.quality === after.quality
    && (after.to === undefined
      || (before.to !== undefined && after.to >= before.to))
  )
}

/** Тема среди индексаторов склеенной раздачи: адрес темы у каждого свой */
export function topicOfRelease<T extends TopicKey>(
  release: Pick<FoundRelease, 'indexers'>,
  topics: T[],
) {
  return topics.find(topic =>
    release.indexers.some(
      item =>
        item.id === topic.indexerId && item.detailsUrl === topic.detailsUrl,
    ),
  )
}

export function titleTopics(titleId: string) {
  return getDb()
    .select()
    .from(trackedTopics)
    .where(eq(trackedTopics.titleId, titleId))
    .all()
}

function topicById(id: string) {
  return getDb()
    .select()
    .from(trackedTopics)
    .where(eq(trackedTopics.id, id))
    .get()
}

function topicByKey(key: TopicKey) {
  return getDb()
    .select()
    .from(trackedTopics)
    .where(
      and(
        eq(trackedTopics.indexerId, key.indexerId),
        eq(trackedTopics.detailsUrl, key.detailsUrl),
      ),
    )
    .get()
}

/** Темы, которыми качаются сезоны слежения */
export function seasonTopics(followId: string) {
  const rows = getDb()
    .select({ season: followSeasons.season, topic: trackedTopics })
    .from(followSeasons)
    .innerJoin(trackedTopics, eq(trackedTopics.id, followSeasons.topicId))
    .where(eq(followSeasons.followId, followId))
    .all()

  return new Map(rows.map(row => [row.season, row.topic]))
}

/** Темы были среди кандидатов прогона */
export function touchTopics(ids: string[], now: Date) {
  if (ids.length) {
    getDb()
      .update(trackedTopics)
      .set({ lastSeenAt: now })
      .where(inArray(trackedTopics.id, ids))
      .run()
  }
}

function setRefresh(topicId: string, refresh: TopicRefresh | null) {
  getDb()
    .update(trackedTopics)
    .set({ refresh })
    .where(eq(trackedTopics.id, topicId))
    .run()
}

/**
 * Автоматика качает сезон из пака с адресом темы: тема отслеживается, её
 * текущая раздача — эта, сезон качается ею.
 */
export function trackTopic(
  follow: Follow,
  torrent: Torrent,
  candidate: FollowPendingCandidate,
  season: number,
  now = new Date(),
) {
  const shape = topicShape(candidate.title)

  if (
    !candidate.indexerId
    || !candidate.detailsUrl
    || !shape
    || shape.season !== season
  ) {
    return
  }

  const db = getDb()
  const indexer = db
    .select({ id: indexers.id })
    .from(indexers)
    .where(eq(indexers.id, candidate.indexerId))
    .get()

  if (!indexer)
    return

  const values = {
    titleId: follow.titleId,
    torrentId: torrent.id,
    infoHash: torrent.infoHash,
    releaseTitle: candidate.title,
    season,
    episodesTo: shape.to ?? null,
    episodesTotal: shape.total ?? null,
    lastSeenAt: now,
    updatedAt: now,
  }
  const topic = db
    .insert(trackedTopics)
    .values({
      ...values,
      indexerId: candidate.indexerId,
      detailsUrl: candidate.detailsUrl,
    })
    .onConflictDoUpdate({
      target: [trackedTopics.indexerId, trackedTopics.detailsUrl],
      set: values,
    })
    .returning()
    .get()

  db.insert(followSeasons)
    .values({ followId: follow.id, season, topicId: topic.id, updatedAt: now })
    .onConflictDoUpdate({
      target: [followSeasons.followId, followSeasons.season],
      set: { topicId: topic.id, updatedAt: now },
    })
    .run()
}

/**
 * Кандидат — новая версия отслеживаемой темы тайтла: тот же ключ, другой
 * infohash, тот же разбор. Тот же infohash — это сама текущая раздача.
 */
export function updatedTopicFor(
  follow: Pick<Follow, 'titleId'>,
  candidate: FollowPendingCandidate,
  infoHash: string | undefined,
) {
  if (!candidate.indexerId || !candidate.detailsUrl)
    return undefined

  const topic = topicByKey({
    indexerId: candidate.indexerId,
    detailsUrl: candidate.detailsUrl,
  })
  const hash = (infoHash ?? candidate.infoHash)?.toLowerCase()

  if (
    !topic
    || topic.titleId !== follow.titleId
    || !topic.torrentId
    || (hash && hash === topic.infoHash)
    || !isTopicUpdate(topic.releaseTitle, candidate.title)
  ) {
    return undefined
  }

  return topic
}

/** Раздачи, которые сейчас подменяют старые версии тем: их ведёт подмена */
export function refreshTargets() {
  const rows = getDb()
    .select({ refresh: trackedTopics.refresh })
    .from(trackedTopics)
    .where(isNotNull(trackedTopics.refresh))
    .all()

  return new Set(rows.flatMap(row => row.refresh?.torrentId ?? []))
}

/**
 * Начинает подмену раздачи темы новой версией. Пока она идёт, серии
 * кандидата «качаются»: захват есть, файла ещё нет. Magnet без метаданных —
 * подмена продолжится, когда раздача будет готова.
 */
export async function startRefresh(
  follow: Follow,
  topic: TrackedTopic,
  next: Torrent,
  candidate: FollowPendingCandidate,
  episodes: EpisodeRef[],
  now: Date,
): Promise<GrabResult> {
  // Тема уже подменяется другой версией: эта подождёт её конца
  if (topic.refresh && topic.refresh.torrentId !== next.id)
    return retryLater(follow, candidate, episodes, now)

  setRefresh(topic.id, {
    followId: follow.id,
    torrentId: next.id,
    title: candidate.title,
    episodes,
    candidate,
    stage: 'prepare',
  })
  updateEpisodes(follow, episodes, {
    torrentId: next.id,
    fileIndex: null,
    grabbedAt: now,
    pending: candidate,
    waitUntil: null,
    stateNote: null,
  })

  return (await refreshSafely(topic.id, now)) ?? 'started'
}

interface RefreshContext {
  topic: TrackedTopic
  refresh: TopicRefresh
  follow: Follow
  next: Torrent
  old: Torrent
  dir: string
  map: Map<number, number>
}

function recordUpdate(
  follow: Pick<Follow, 'id' | 'titleId'>,
  topic: TrackedTopic,
  next: Torrent,
  refresh: TopicRefresh,
  params: Record<string, unknown>,
  now: Date,
) {
  const shape = topicShape(refresh.title)

  recordHistory(
    {
      followId: follow.id,
      titleId: follow.titleId,
      kind: 'topic_updated',
      season: topic.season ?? undefined,
      episodes: refresh.episodes.map(item => item.episode),
      releaseTitle: refresh.title,
      indexerId: topic.indexerId,
      torrentId: next.id,
      params: {
        ...(topic.episodesTo !== null && { from: topic.episodesTo }),
        ...(shape?.to !== undefined && { to: shape.to }),
        ...(shape?.total !== undefined && { total: shape.total }),
        ...params,
      },
    },
    now,
  )
}

/** Подмена не состоялась после `forget`: старая раздача — снова в движок */
async function restoreOld(refresh: TopicRefresh, old: Torrent | undefined) {
  if (refresh.forgotten && old?.retention === 'keep') {
    await downloadFiles(old, old.selectedFiles ?? [], {
      dir: old.downloadDir,
    })
  }
}

/**
 * Запасной путь: новая версия качается рядом обычным захватом только с
 * сериями кандидата, старая остаётся. Поставленные ссылки убираются, а
 * забытая в движке старая раздача возвращается туда.
 */
async function fallBack(ctx: RefreshContext, now: Date) {
  const { topic, refresh, follow, next, old, dir, map } = ctx

  await unlinkCarried(old, next, map, dir)
  await restoreOld(refresh, old)
  setRefresh(topic.id, null)

  const result = await startGrab(
    follow,
    next,
    refresh.candidate,
    refresh.episodes,
    { now },
  )

  if (result === 'started')
    recordUpdate(follow, topic, next, refresh, { fallback: true }, now)

  return result
}

/** Индексы файлов старой версии, которые лежат в библиотеке */
function libraryIndexes(torrent: Torrent) {
  return new Set(
    torrentLibraryFiles(torrent.id).flatMap(row =>
      row.fileIndex === null ? [] : [row.fileIndex],
    ),
  )
}

/**
 * Всё до перепривязки: ссылки при новом имени, сверка с диском и место —
 * пока старая раздача ещё в движке и запасной путь ничего не откатывает;
 * затем старая забывается, а не сошедшееся с диском убирается из загрузок.
 * `undefined` — можно перепривязывать; иначе итог захвата.
 */
async function prepare(
  ctx: RefreshContext,
  now: Date,
): Promise<GrabResult | undefined> {
  const { topic, refresh, follow, next, old, dir, map } = ctx
  const sameName = old.name === next.name

  // Новую версию уже смотрели: в движке она лежит в чужом каталоге
  if (next.inEngine)
    await forgetKeepingFiles(next)

  if (!sameName) {
    try {
      await linkCarried(old, next, map, dir)
    }
    catch (err) {
      if (err instanceof NoLinkError)
        return fallBack(ctx, now)

      throw err
    }
  }

  let onDisk: string[]

  try {
    onDisk = await compareOnDisk(next, dir)
  }
  catch (err) {
    if (!(err instanceof EngineError))
      throw err

    logFor('catalog').warn(
      { err, titleId: topic.titleId, torrentId: next.id },
      'Topic refresh could not compare files on disk',
    )

    // С тем же именем рядом не положить: файлы общие, ждём
    if (sameName) {
      setRefresh(topic.id, {
        ...refresh,
        retryAt: new Date(now.getTime() + RETRY_MS).toISOString(),
      })
      return 'later'
    }

    return fallBack(ctx, now)
  }

  const files = filesFor(next, refresh.title, follow.kind, refresh.episodes)
  const absent = refresh.episodes.filter(
    item => !files.has(episodeKey(item)),
  )

  if (absent.length) {
    blockTorrent(follow, next, 'failed_check', absent, topic.detailsUrl)
    resetEpisodes(follow, absent)
    refresh.episodes = refresh.episodes.filter(item =>
      files.has(episodeKey(item)),
    )
  }

  const kept = new Set([...(old.selectedFiles ?? []), ...libraryIndexes(old)])
  const selection = [
    ...new Set([
      ...[...map].filter(([from]) => kept.has(from)).map(([, to]) => to),
      ...files.values(),
    ]),
  ]
  const changed = onDisk.flatMap((state, index) =>
    state === 'differs' || state === 'unknown' ? [index] : [],
  )
  const bytes = selection
    .filter(index => onDisk[index] !== 'match')
    .reduce((sum, index) => sum + (next.files?.[index]?.size ?? 0), 0)

  try {
    await ensureSpaceFor({
      torrent: {
        ...next,
        retention: 'keep',
        inEngine: true,
        downloadDir: old.downloadDir,
      },
      bytes,
    })
  }
  catch (err) {
    if (!(err instanceof InsufficientStorageError))
      throw err

    await unlinkCarried(old, next, map, dir)
    setRefresh(topic.id, null)
    updateEpisodes(follow, refresh.episodes, {
      torrentId: null,
      fileIndex: null,
      grabbedAt: null,
      pending: refresh.candidate,
      stateNote: 'no_space',
    })
    return 'no_space'
  }

  if (old.inEngine) {
    await forgetKeepingFiles(old)
    refresh.forgotten = true
    setRefresh(topic.id, refresh)
  }

  // Не сошедшееся anacrolix переписал бы на месте, а файл загрузок бывает
  // хардлинком файла библиотеки: новая версия ляжет в новый inode
  await removeFiles(
    changed.flatMap(index => diskPathOf(next, index, dir) ?? []),
    join(dir, next.name),
  )

  Object.assign(refresh, {
    selection,
    downloadDir: old.downloadDir,
    redownload: changed,
  })
  delete refresh.retryAt
  return undefined
}

/**
 * Одна транзакция до добавления в движок: библиотека, прогресс, позиции и
 * серии слежения переходят к новой версии по карте файлов, тема — на неё,
 * старая строка удаляется последней (у `watch_states` каскад). Пока новой
 * нет в движке, связыватель её не раскладывает — файлы не задвоятся.
 */
function relink(ctx: RefreshContext, now: Date) {
  const { topic, refresh, follow, next, old, dir, map } = ctx
  const shape = topicShape(refresh.title)
  const files = filesFor(next, refresh.title, follow.kind, refresh.episodes)
  const nextPaths = new Set(
    (next.files ?? []).map((_, index) => diskPathOf(next, index, dir)),
  )
  const cleanup = (old.files ?? []).flatMap((_, index) => {
    const path = diskPathOf(old, index, dir)

    return path && !nextPaths.has(path) ? [path] : []
  })
  const db = getDb()

  db.transaction(() => {
    relinkMediaFiles(old.id, next.id, map, new Set(refresh.redownload ?? []))
    relinkTitleProgress(old.id, next.id, map)
    moveWatchStates(old.id, next.id, map)

    const grabbed = db
      .select()
      .from(followEpisodes)
      .where(eq(followEpisodes.torrentId, old.id))
      .all()

    for (const row of grabbed) {
      const fileIndex
        = row.fileIndex === null ? undefined : map.get(row.fileIndex)

      db.update(followEpisodes)
        .set(
          fileIndex === undefined
            ? { torrentId: null, fileIndex: null }
            : { torrentId: next.id, fileIndex },
        )
        .where(
          and(
            eq(followEpisodes.followId, row.followId),
            eq(followEpisodes.season, row.season),
            eq(followEpisodes.episode, row.episode),
          ),
        )
        .run()
    }

    for (const episode of refresh.episodes) {
      updateEpisodes(follow, [episode], {
        torrentId: next.id,
        fileIndex: files.get(episodeKey(episode)) ?? null,
        grabbedAt: now,
        grabbedTitle: refresh.title,
        pending: null,
        waitUntil: null,
        stateNote: null,
      })
    }

    db.update(torrents)
      .set({
        retention: 'keep',
        selectedFiles: refresh.selection ?? [],
        downloadDir: refresh.downloadDir ?? null,
        ...(old.seedRule && !next.seedRule && { seedRule: old.seedRule }),
      })
      .where(eq(torrents.id, next.id))
      .run()
    db.update(trackedTopics)
      .set({
        torrentId: next.id,
        infoHash: next.infoHash,
        releaseTitle: refresh.title,
        episodesTo: shape?.to ?? null,
        episodesTotal: shape?.total ?? null,
        lastSeenAt: now,
        updatedAt: now,
        refresh: {
          ...refresh,
          stage: 'relinked',
          cleanup: { root: join(dir, old.name), paths: cleanup },
        },
      })
      .where(eq(trackedTopics.id, topic.id))
      .run()
    recordUpdate(
      follow,
      topic,
      next,
      refresh,
      { carried: map.size, redownload: refresh.redownload?.length ?? 0 },
      now,
    )
    db.delete(torrents).where(eq(torrents.id, old.id)).run()
  })

  logFor('catalog').info(
    {
      titleId: topic.titleId,
      from: old.infoHash,
      to: next.infoHash,
      carried: map.size,
      redownload: refresh.redownload?.length ?? 0,
    },
    'Topic torrent replaced with its new version',
  )
}

/** Новая версия — в движок, в каталог старой, с сохранённым выбором */
async function addNext(topic: TrackedTopic, refresh: TopicRefresh) {
  const next = getTorrent(refresh.torrentId)

  if (next) {
    await downloadFiles(next, refresh.selection ?? next.selectedFiles ?? [], {
      dir: refresh.downloadDir ?? null,
    })
  }

  setRefresh(topic.id, { ...refresh, stage: 'added' })
}

/**
 * Подмена с того этапа, на котором она остановилась: этап, ссылки и файлы
 * видны по строкам и диску, поэтому каждый шаг можно пройти ещё раз.
 * `undefined` — подмена закончена или снята.
 */
export async function runRefresh(
  topicId: string,
  now = new Date(),
): Promise<GrabResult | undefined> {
  const topic = topicById(topicId)
  const refresh = topic?.refresh

  if (!topic || !refresh)
    return undefined

  if (refresh.retryAt && new Date(refresh.retryAt) > now)
    return 'later'

  if (refresh.stage === 'added') {
    await removeFiles(
      refresh.cleanup?.paths ?? [],
      refresh.cleanup?.root ?? '',
    )
    setRefresh(topic.id, null)
    void syncLibrary()
    return 'started'
  }

  if (refresh.stage === 'relinked') {
    if (!isEngineReady())
      return 'later'

    await addNext(topic, refresh)
    return runRefresh(topic.id, now)
  }

  const follow = followById(refresh.followId)
  const next = getTorrent(refresh.torrentId)
  const old = topic.torrentId ? getTorrent(topic.torrentId) : undefined

  // Слежение или новую версию удалили: подменять нечем
  if (!follow || !next) {
    await restoreOld(refresh, old)
    setRefresh(topic.id, null)

    if (follow)
      resetEpisodes(follow, refresh.episodes)

    return undefined
  }

  if (next.status === 'resolving')
    return 'resolving'

  if (next.status === 'failed') {
    setRefresh(topic.id, null)
    blockTorrent(follow, next, 'stalled', refresh.episodes, topic.detailsUrl)
    resetEpisodes(follow, refresh.episodes)
    return 'blocked'
  }

  // Старую версию удалили: подменять нечего, новая качается как обычно
  if (!old?.files) {
    setRefresh(topic.id, null)
    return startGrab(follow, next, refresh.candidate, refresh.episodes, {
      now,
    })
  }

  if (
    !isEngineReady()
    || isStreaming(old.id)
    || isMovingTorrent(old.id)
    || isMovingTorrent(next.id)
  ) {
    return 'later'
  }

  const ctx: RefreshContext = {
    topic,
    refresh,
    follow,
    next,
    old,
    dir: resolve(torrentDir(old)),
    map: carryMap(old, next),
  }
  const result = await prepare(ctx, now)

  if (result)
    return result

  if (!topicById(topic.id)?.refresh)
    return undefined

  relink(ctx, now)
  return runRefresh(topic.id, now)
}

/** Сбой посреди подмены — повтор позже с того же этапа */
async function refreshSafely(topicId: string, now: Date) {
  try {
    return await runRefresh(topicId, now)
  }
  catch (err) {
    logFor('catalog').warn({ err, topicId }, 'Topic refresh failed')

    const topic = topicById(topicId)

    if (topic?.refresh) {
      setRefresh(topicId, {
        ...topic.refresh,
        retryAt: new Date(now.getTime() + RETRY_MS).toISOString(),
      })
    }

    return 'later' as const
  }
}

/**
 * Незаконченные подмены тем — после перезапуска или пока ждали движок,
 * метаданные и конец просмотра старой версии. Идут при любом состоянии
 * слежения: забытая старая и не добавленная новая не должны так остаться.
 */
export async function continueRefreshes(now = new Date()) {
  const ids = getDb()
    .select({ id: trackedTopics.id })
    .from(trackedTopics)
    .where(isNotNull(trackedTopics.refresh))
    .all()

  for (const { id } of ids) await refreshSafely(id, now)
}
