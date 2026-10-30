import type {
  FollowTitleInput,
  LibraryFile,
  MarkWatched,
  MarkWatchedInput,
  MessageResponse,
  OpenFollowPickInput,
  TitleFollow,
  TitleFollowResponse,
  TitleLibrary,
  TitleMine,
  TitleOpen,
  TitleProgress,
  UpdateTitleMineInput,
  UpNext,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import { del, DemoError, get, patch, post, put } from '@torsher/demo/router'
import { airedEpisodes, detailsOf, seasonOf } from '@torsher/demo/titles'
import { titleById } from '../cards.ts'
import {
  episodeFile,
  fileOf,
  libraryFilesOf,
  torrentById,
  torrentsOf,
} from '../library.ts'
import {
  airedList,
  collections,
  follows,
  lastProgress,
  mineEntry,
  progressOf,
  resumeOf,
  setWatched,
  statusOf,
} from '../viewer.ts'

function mineOf(title: DemoTitle): TitleMine {
  const entry = mineEntry(title.id)

  return {
    watchlist: !!entry.watchlistAt,
    favorite: !!entry.favoriteAt,
    rating: entry.rating ?? null,
    status: statusOf(title),
    collections: collections.map(item => ({
      id: item.id,
      name: item.name,
      contains: item.titles.includes(title.id),
    })),
  }
}

get<TitleMine>('/api/titles/:id/mine', ({ params }) =>
  mineOf(titleById(params.id!)))

patch<TitleMine, UpdateTitleMineInput>(
  '/api/titles/:id/mine',
  ({ params, body }) => {
    const title = titleById(params.id!)
    const entry = mineEntry(title.id)
    const now = Date.now()

    if (body.watchlist !== undefined)
      entry.watchlistAt = body.watchlist ? now : undefined
    if (body.favorite !== undefined)
      entry.favoriteAt = body.favorite ? now : undefined
    if (body.rating !== undefined) {
      entry.rating = body.rating ?? undefined
      entry.ratedAt = body.rating ? now : undefined
    }
    if (body.dropped !== undefined)
      entry.droppedAt = body.dropped ? now : undefined

    return mineOf(title)
  },
)

/** Без сезона — весь тайтл, без серии — весь сезон: только вышедшие серии */
put<MarkWatched, MarkWatchedInput>(
  '/api/titles/:id/watched',
  ({ params, body }) => {
    const title = titleById(params.id!)

    if (title.kind === 'movie') {
      setWatched(title.id, 0, 0, body.watched)
    }
    else {
      for (const item of airedList(title)) {
        if (
          (body.season === undefined || item.season === body.season)
          && (body.episode === undefined || item.episode === body.episode)
        ) {
          setWatched(title.id, item.season, item.episode, body.watched)
        }
      }
    }

    if (body.watched)
      mineEntry(title.id).droppedAt = undefined

    return body
  },
)

get<TitleProgress>('/api/titles/:id/progress', ({ params }) => {
  const title = titleById(params.id!)
  const last = lastProgress(title.id)
  const points = progressOf(title.id)
  const releases = torrentsOf(title.id).filter(
    item => item.seasons.length === 1 && item.pendingPolls === 0,
  )
  const watchedFrom = new Set(points.map(point => point.torrentId))

  return {
    resume: resumeOf(title),
    last: last
      ? {
          season: last.season || null,
          episode: last.episode || null,
          position: last.position,
          duration: last.duration,
          watched: last.watched,
          updatedAt: new Date(last.updatedAt).toISOString(),
        }
      : null,
    // Раздача сезона — та, из которой его смотрели
    seasonReleases: releases
      .filter(item => watchedFrom.has(item.id))
      .map(item => ({
        season: item.seasons[0]!,
        torrentId: item.id,
        quality: item.quality,
        voice: null,
        episodes: item.files.flatMap(file => file.episode ?? []),
      })),
    episodes: points
      .filter(point => point.season > 0)
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
      .map(point => ({
        season: point.season,
        episode: point.episode,
        position: point.position,
        duration: point.duration,
        watched: point.watched,
      })),
  }
})

get<TitleLibrary>('/api/titles/:id/library', ({ params }) => ({
  files: libraryFilesOf(titleById(params.id!).id) satisfies LibraryFile[],
}))

/** Следующая вышедшая серия: в той же раздаче, если она там есть */
get<UpNext>('/api/titles/:id/up-next', ({ params, query }) => {
  const title = titleById(params.id!)
  const season = Number(query.get('season'))
  const episode = Number(query.get('episode'))
  const next
    = episode < airedEpisodes(title, season)
      ? { season, episode: episode + 1 }
      : airedEpisodes(title, season + 1) > 0
        ? { season: season + 1, episode: 1 }
        : undefined

  if (!next)
    return { next: null }

  const info = seasonOf(title, next.season)?.episodes[next.episode - 1]
  const torrent = torrentById(query.get('torrentId') ?? '')
  const inTorrent = torrent && fileOf(torrent, next.season, next.episode)

  return {
    next: {
      ...next,
      title: info?.title ?? '',
      still: info?.still,
      file: inTorrent
        ? { torrentId: torrent.id, fileIndex: inTorrent.fileIndex }
        : episodeFile(title.id, next.season, next.episode),
    },
  }
})

// «Следить»: новые серии качаются сами; готовых серий в демо нет

const followSettings = new Map<string, Required<FollowTitleInput>>()

const DEFAULT_FOLLOW: Required<FollowTitleInput> = {
  voiceStudio: null,
  voiceStrict: false,
  requireRussian: false,
  waitHours: 24,
  qualityPreset: 'best',
  mode: 'download',
}

function followOf(title: DemoTitle): TitleFollowResponse {
  if (!follows.has(title.id))
    return { follow: null, canEdit: true }

  const settings = followSettings.get(title.id) ?? DEFAULT_FOLLOW
  const season = title.seasons?.length ?? 1
  const next = detailsOf(title).nextEpisode
  const follow: TitleFollow = {
    id: `follow-${title.id}`,
    kind: title.kind,
    state: next || title.kind === 'movie' ? 'active' : 'done',
    start: { season, episode: 1 },
    voiceStudio: settings.voiceStudio,
    voiceStrict: settings.voiceStrict,
    requireRussian: settings.requireRussian,
    waitHours: settings.waitHours,
    qualityPreset: settings.qualityPreset,
    mode: settings.mode,
    next: next ?? null,
    subscribed: true,
    profileCount: 1,
    season,
    voice: null,
    quality: {
      value:
        settings.qualityPreset === 'uhd'
          ? '2160p'
          : settings.qualityPreset === 'compact'
            ? '720p'
            : '1080p',
      lowered: false,
    },
    waiting: null,
    counts: { downloading: 0, noSpace: 0, missing: 0, searching: 0, ready: 0 },
    first: {},
    ready: null,
  }

  return { follow, canEdit: true }
}

get<TitleFollowResponse>('/api/titles/:id/follow', ({ params }) =>
  followOf(titleById(params.id!)))

put<TitleFollowResponse, FollowTitleInput>(
  '/api/titles/:id/follow',
  ({ params, body }) => {
    const title = titleById(params.id!)

    follows.add(title.id)
    followSettings.set(title.id, {
      ...(followSettings.get(title.id) ?? DEFAULT_FOLLOW),
      ...body,
    })

    return followOf(title)
  },
)

del<TitleFollowResponse>('/api/titles/:id/follow', ({ params }) => {
  const title = titleById(params.id!)

  follows.delete(title.id)
  return followOf(title)
})

// Раздачи, выбранной «Следить» в режиме «Только уведомлять», в демо нет:
// витрина ищет серию по раздачам тайтла
post<TitleOpen, OpenFollowPickInput>('/api/titles/:id/follow/open', () => {
  throw new DemoError(404, { message: 'Nothing picked' })
})

put<MessageResponse>('/api/collections/:id/titles/:titleId', ({ params }) => {
  const collection = collections.find(item => item.id === params.id)
  const title = titleById(params.titleId!)

  if (!collection)
    throw new DemoError(404, { message: 'Collection not found' })

  if (!collection.titles.includes(title.id))
    collection.titles.unshift(title.id)

  return { message: 'ok' }
})

del<MessageResponse>('/api/collections/:id/titles/:titleId', ({ params }) => {
  const collection = collections.find(item => item.id === params.id)

  if (!collection)
    throw new DemoError(404, { message: 'Collection not found' })

  collection.titles = collection.titles.filter(id => id !== params.titleId)
  return { message: 'ok' }
})
