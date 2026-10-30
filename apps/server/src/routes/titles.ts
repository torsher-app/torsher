import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { EngineTorrentState } from '../services/engine/index.ts'
import type { RankedRelease, TitleSources } from '../services/sources/index.ts'
import { messageResponse } from '../dto/common.ts'
import { insufficientStorageResponse } from '../dto/playback.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import {
  cancelTitleDownloadQuery,
  downloadTitle as downloadTitleBody,
  markWatched as markWatchedBody,
  openTitle,
  pinTitleVoice,
  titleDownload,
  titleDownloadStart,
  titleFiles,
  titleFilesParams,
  titleLibrary,
  titleOpen,
  titleParams,
  titleProgress,
  titleProgressQuery,
  titleSources,
  titleSourcesQuery,
  titleWatch,
  upNext,
  upNextQuery,
  watchErrorResponse,
  watchTitle as watchTitleBody,
} from '../dto/titles.ts'
import { titleMine, titleMineQuery, updateTitleMine } from '../dto/mine.ts'
import { requireViewer } from '../middleware/auth.ts'
import {
  placedFilesByTorrent,
  qualityOf,
  syncLibrary,
  titleLibraryFiles,
} from '../services/library/index.ts'
import { visibleFolderIds } from '../services/library/folders.ts'
import { titleDownload as titleDownloadOf } from '../services/library/status.ts'
import {
  getTitleMine,
  markTitleWatched,
  MineNotFoundError,
  updateMine,
} from '../services/mine/index.ts'
import {
  DEFAULT_PROFILE,
  getTitleSources,
  pinVoice,
  voiceKeysOf,
} from '../services/sources/index.ts'
import {
  cancelTitleDownload,
  DownloadNotFoundError,
  downloadTitle,
  keepTitle,
  NothingToCancelError,
  NothingToKeepError,
} from '../services/sources/download.ts'
import { titleFiles as filesOfTorrent } from '../services/sources/files.ts'
import {
  episodeProgress,
  isProgressWatched,
  lastTitleProgress,
  markWatched,
} from '../services/sources/progress.ts'
import {
  episodeFileIn,
  nextEpisodeFor,
  resumeTarget,
} from '../services/sources/resume.ts'
import { seasonReleases } from '../services/sources/seasonRelease.ts'
import {
  openCandidate,
  WatchError,
  watchTitle,
} from '../services/sources/watch.ts'
import { getTorrent, liveTorrents } from '../services/torrents/index.ts'
import { getSeason, getTitle, TmdbError } from '../services/tmdb/index.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import { sendTmdbError } from './catalog.ts'
import { sendEngineError } from './engineResponses.ts'

const guardResponses = {
  401: messageResponse,
}

/** Значок файла на «Файлах»: в библиотеке, скачан целиком или качается */
function fileDownloadOf(
  index: number,
  size: number,
  live: EngineTorrentState | undefined,
  placed: Set<number> | undefined,
) {
  if (placed?.has(index))
    return { state: 'library' as const, progress: 1 }

  if (!live?.selected.includes(index))
    return null

  const progress
    = size > 0 ? Math.min(1, (live.fileProgress[index] ?? 0) / size) : 0

  return {
    state: progress >= 1 ? ('downloaded' as const) : ('downloading' as const),
    progress,
  }
}

const tmdbResponses = {
  404: messageResponse,
  502: messageResponse,
  503: messageResponse,
}

/** Сезоны сериала с числом вышедших серий; у фильма и без TMDB — undefined */
async function airedSeasons(titleId: string, language: string) {
  const details = await getTitle(titleId, language)

  return details?.seasons?.map(season => ({
    number: season.number,
    airedEpisodeCount: season.airedEpisodeCount,
  }))
}

function toCandidate(
  release: RankedRelease,
  lastWatched: boolean,
  russian: boolean,
) {
  const { parsed } = release

  return {
    id: release.id,
    title: release.title,
    indexers: release.indexers.map(indexer => indexer.name),
    size: release.size ?? null,
    episodeSize: release.episodeSize ?? null,
    seeders: release.seeders,
    peers: release.peers ?? null,
    quality: parsed.quality ?? null,
    resolution: release.resolution ?? null,
    source: parsed.source ?? null,
    codec: parsed.codec ?? null,
    hdr: parsed.hdr,
    audio: parsed.audio,
    channels: parsed.channels ?? null,
    subs: parsed.subs,
    // Основная озвучка и её ключи — русские: у другого языка озвучки строку
    // подписывают дорожки из `audio`
    voice: russian ? (release.voice ?? null) : null,
    voiceKeys: russian ? voiceKeysOf(release) : [],
    audioFit: release.audioFit ?? null,
    seasons: parsed.seasons,
    episodes: parsed.episodes
      ? {
          from: parsed.episodes.from,
          to: parsed.episodes.to,
          total: parsed.episodes.total,
        }
      : null,
    isPack: parsed.isPack,
    confidence:
      release.match.confidence === 'high'
        ? ('high' as const)
        : ('medium' as const),
    pickReason: release.reason ?? null,
    publishedAt: release.publishedAt?.toISOString() ?? null,
    lastWatched,
  }
}

/** Ссылки индексаторов и infohash наружу не уходят: ответ собирается явно */
export function toSourcesResponse(sources: TitleSources) {
  return {
    season: sources.season ?? null,
    episode: sources.episode ?? null,
    updatedAt: sources.updatedAt.toISOString(),
    audio: sources.audio,
    profile: {
      qualities: DEFAULT_PROFILE.qualities,
      voiceTypes: DEFAULT_PROFILE.voiceTypes,
    },
    pinnedVoice: sources.pinned ?? null,
    seasonCandidate: sources.seasonCandidate ?? null,
    top: sources.ranking.top,
    candidates: sources.ranking.ranked.map(release =>
      toCandidate(
        release,
        release.id === sources.lastWatchedId,
        sources.audio === 'ru',
      ),
    ),
    voices: sources.voices,
    query: {
      current: sources.query ?? null,
      suggestions: sources.querySuggestions,
    },
    indexers: {
      total: sources.indexerCount,
      failed: sources.failed.map(({ name, kind }) => ({ name, kind })),
    },
  }
}

export const titleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireViewer)

  app.get(
    '/:id/sources',
    {
      schema: {
        operationId: 'getTitleSources',
        tags: ['Titles'],
        params: titleParams,
        querystring: titleSourcesQuery,
        response: {
          200: titleSources,
          400: messageResponse,
          ...guardResponses,
          ...tmdbResponses,
        },
      },
    },
    async (request, reply) => {
      const { season, episode, refresh, all, query } = request.query

      try {
        const sources = await getTitleSources(request.params.id, {
          season: season === undefined ? undefined : Number(season),
          episode: episode === undefined ? undefined : Number(episode),
          refresh: refresh === '1',
          allSeasons: all === '1',
          profileId: request.profileId,
          query,
        })

        if (!sources)
          return reply.code(404).send({ message: 'Title not found' })

        return toSourcesResponse(sources)
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.put(
    '/:id/voice',
    {
      schema: {
        operationId: 'putTitleVoice',
        tags: ['Titles'],
        params: titleParams,
        body: pinTitleVoice,
        response: {
          200: pinTitleVoice,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      const { season, voice } = request.body

      pinVoice(request.params.id, season, voice)

      return { season, voice }
    },
  )

  app.post(
    '/:id/watch',
    {
      schema: {
        operationId: 'postTitleWatch',
        tags: ['Titles'],
        params: titleParams,
        body: watchTitleBody,
        response: {
          200: titleWatch,
          202: titleWatch,
          400: messageResponse,
          ...guardResponses,
          ...tmdbResponses,
          422: watchErrorResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
        },
      },
    },
    async (request, reply) => {
      let result

      try {
        result = await watchTitle(
          request.params.id,
          request.body,
          request.profileId,
        )
      }
      catch (err) {
        if (err instanceof WatchError)
          return reply.code(422).send({ message: err.message, kind: err.kind })

        if (err instanceof TmdbError)
          return sendTmdbError(reply, err)

        return sendEngineError(reply, err)
      }

      if (!result)
        return reply.code(404).send({ message: 'Title not found' })

      if (result.status === 'resolving') {
        return reply.code(202).send({ ...result, fileIndex: null })
      }

      return result
    },
  )

  app.get(
    '/:id/progress',
    {
      schema: {
        operationId: 'getTitleProgress',
        tags: ['Titles'],
        params: titleParams,
        querystring: titleProgressQuery,
        response: {
          200: titleProgress,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      const { id } = request.params
      const last = lastTitleProgress(request.profileId, id)
      // Без TMDB следующей серии не найти: кнопка остаётся «Смотреть»
      const resume = await resumeTarget(request.profileId, id, () =>
        airedSeasons(id, request.query.language).catch(() => undefined))

      return {
        resume: resume
          ? {
              season: resume.season,
              episode: resume.episode,
              position: resume.position,
              duration: resume.duration,
              next: resume.next,
              file: resume.file,
            }
          : null,
        last: last
          ? {
              season: last.season || null,
              episode: last.episode || null,
              position: last.position,
              duration: last.duration,
              watched: isProgressWatched(last),
              updatedAt: last.updatedAt.toISOString(),
            }
          : null,
        episodes: episodeProgress(request.profileId, request.params.id).map(
          row => ({
            season: row.season,
            episode: row.episode,
            position: row.position,
            duration: row.duration,
            watched: isProgressWatched(row),
          }),
        ),
        seasonReleases: seasonReleases(
          request.profileId,
          request.params.id,
        ).map(release => ({
          season: release.season,
          torrentId: release.torrent.id,
          quality: release.quality ?? null,
          voice: release.voice ?? null,
          episodes: release.episodes,
        })),
      }
    },
  )

  app.get(
    '/:id/up-next',
    {
      schema: {
        operationId: 'getTitleUpNext',
        tags: ['Titles'],
        params: titleParams,
        querystring: upNextQuery,
        response: {
          200: upNext,
          400: messageResponse,
          ...tmdbResponses,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { language, torrentId } = request.query

      if (parseCatalogId(id)?.type !== 'tv')
        return reply.code(404).send({ message: 'Series not found' })

      try {
        const seasons = await airedSeasons(id, language)
        const next = nextEpisodeFor(request.profileId, id, seasons ?? [], {
          season: Number(request.query.season),
          episode: Number(request.query.episode),
        })

        if (!next)
          return { next: null }

        const episode = (
          await getSeason(id, next.season, language).catch(() => undefined)
        )?.episodes.find(item => item.number === next.episode)

        return {
          next: {
            ...next,
            title: episode?.title ?? '',
            still: episode?.still,
            file: torrentId
              ? episodeFileIn(torrentId, {
                  profileId: request.profileId,
                  titleId: id,
                  ...next,
                })
              : null,
          },
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.post(
    '/:id/open',
    {
      schema: {
        operationId: 'postTitleOpen',
        tags: ['Titles'],
        params: titleParams,
        body: openTitle,
        response: {
          200: titleOpen,
          400: messageResponse,
          ...guardResponses,
          ...tmdbResponses,
          422: watchErrorResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
        },
      },
    },
    async (request, reply) => {
      let result

      try {
        result = await openCandidate(
          request.params.id,
          request.body.candidateId,
          request.profileId,
          request.body.query,
        )
      }
      catch (err) {
        if (err instanceof WatchError)
          return reply.code(422).send({ message: err.message, kind: err.kind })

        if (err instanceof TmdbError)
          return sendTmdbError(reply, err)

        return sendEngineError(reply, err)
      }

      if (!result)
        return reply.code(404).send({ message: 'Title not found' })

      return result
    },
  )

  app.get(
    '/:id/files/:torrentId',
    {
      schema: {
        operationId: 'getTitleFiles',
        tags: ['Titles'],
        params: titleFilesParams,
        response: {
          200: titleFiles,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const ref = parseCatalogId(request.params.id)
      const torrent = getTorrent(request.params.torrentId)

      // Только раздачи этого тайтла: чужие файлы экран «Файлы» не показывает
      if (!ref || !torrent || torrent.titleId !== request.params.id)
        return reply.code(404).send({ message: 'Release not found' })

      if (torrent.status !== 'ready')
        return { status: 'resolving' as const, name: torrent.name, files: [] }

      const live = (await liveTorrents()).get(torrent.infoHash)
      const placed = placedFilesByTorrent([torrent.id]).get(torrent.id)

      return {
        status: 'ready' as const,
        name: torrent.name,
        files: filesOfTorrent(torrent, {
          profileId: request.profileId,
          titleId: request.params.id,
          kind: ref.type === 'movie' ? 'movie' : 'series',
        }).map(file => ({
          ...file,
          season: file.season ?? null,
          episode: file.episode ?? null,
          download: fileDownloadOf(file.fileIndex, file.size, live, placed),
        })),
      }
    },
  )

  // Файлы тайтла в библиотеке: «Смотреть» играет их сразу, без поиска раздач
  app.get(
    '/:id/library',
    {
      schema: {
        operationId: 'getTitleLibrary',
        tags: ['Titles'],
        params: titleParams,
        response: {
          200: titleLibrary,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      return {
        // Файлы из библиотек, скрытых от профиля, не показываем
        files: titleLibraryFiles(
          request.params.id,
          visibleFolderIds(request.profileId),
        ).map(file => ({
          id: file.id,
          season: file.season || null,
          episode: file.episode || null,
          episodeTo: file.episodeTo,
          quality: qualityOf(file.probe),
          size: file.size,
          duration: file.duration,
        })),
      }
    },
  )

  // Состояние загрузки тайтла для карточки: живые данные движка
  app.get(
    '/:id/download',
    {
      schema: {
        operationId: 'getTitleDownload',
        tags: ['Titles'],
        params: titleParams,
        response: {
          200: titleDownload,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      return titleDownloadOf(request.params.id, await liveTorrents())
    },
  )

  // «Скачать фильм / сезон» и «Скачать выбранное»: закачка целиком, в библиотеку
  app.post(
    '/:id/download',
    {
      schema: {
        operationId: 'postTitleDownload',
        tags: ['Titles'],
        params: titleParams,
        body: downloadTitleBody,
        response: {
          200: titleDownloadStart,
          202: titleDownloadStart,
          400: messageResponse,
          ...guardResponses,
          ...tmdbResponses,
          422: watchErrorResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
          507: insufficientStorageResponse,
        },
      },
    },
    async (request, reply) => {
      let result

      try {
        result = await downloadTitle(
          request.params.id,
          request.body,
          request.profileId,
        )
      }
      catch (err) {
        if (err instanceof DownloadNotFoundError)
          return reply.code(404).send({ message: err.message })

        if (err instanceof WatchError)
          return reply.code(422).send({ message: err.message, kind: err.kind })

        if (err instanceof TmdbError)
          return sendTmdbError(reply, err)

        return sendEngineError(reply, err)
      }

      if (!result)
        return reply.code(404).send({ message: 'Title not found' })

      if (result.status === 'resolving')
        return reply.code(202).send({ ...result, files: 0, bytes: 0 })

      // Уже скачанные целиком файлы ложатся в библиотеку сразу
      void syncLibrary()
      return { ...result, candidateId: '' }
    },
  )

  // «Отменить загрузку»: полная закачка встаёт, скачанное остаётся в кэше
  app.delete(
    '/:id/download',
    {
      schema: {
        operationId: 'deleteTitleDownload',
        tags: ['Titles'],
        params: titleParams,
        querystring: cancelTitleDownloadQuery,
        response: {
          200: titleDownload,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
          502: messageResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      try {
        await cancelTitleDownload(request.params.id, request.query.torrentId)
      }
      catch (err) {
        if (err instanceof NothingToCancelError)
          return reply.code(409).send({ message: err.message })

        return sendEngineError(reply, err)
      }

      return titleDownloadOf(request.params.id, await liveTorrents())
    },
  )

  // «Оставить»: просмотренное из кэша докачивается и ложится в библиотеку
  app.post(
    '/:id/keep',
    {
      schema: {
        operationId: 'postTitleKeep',
        tags: ['Titles'],
        params: titleParams,
        response: {
          200: titleDownload,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
          502: messageResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
          507: insufficientStorageResponse,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      try {
        await keepTitle(request.params.id)
      }
      catch (err) {
        if (err instanceof NothingToKeepError)
          return reply.code(409).send({ message: err.message })

        return sendEngineError(reply, err)
      }

      void syncLibrary()
      return titleDownloadOf(request.params.id, await liveTorrents())
    },
  )

  app.put(
    '/:id/watched',
    {
      schema: {
        operationId: 'putTitleWatched',
        tags: ['Titles'],
        params: titleParams,
        querystring: titleMineQuery,
        body: markWatchedBody,
        response: {
          200: markWatchedBody,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      const { season, episode, watched } = request.body
      const titleId = request.params.id

      // Без серии у сериала — все вышедшие серии
      if (season === undefined || episode === undefined) {
        try {
          await markTitleWatched(
            request.profileId,
            titleId,
            watched,
            request.query.language,
          )
        }
        catch (err) {
          if (err instanceof MineNotFoundError)
            return reply.code(404).send({ message: err.message })

          throw err
        }

        return { season, episode, watched }
      }

      markWatched(
        { profileId: request.profileId, titleId, season, episode },
        watched,
      )

      return { season, episode, watched }
    },
  )

  app.get(
    '/:id/mine',
    {
      schema: {
        operationId: 'getTitleMine',
        tags: ['Titles'],
        params: titleParams,
        querystring: titleMineQuery,
        response: { 200: titleMine, 404: messageResponse, ...guardResponses },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      return getTitleMine(
        request.profileId,
        request.params.id,
        request.query.language,
      )
    },
  )

  app.patch(
    '/:id/mine',
    {
      schema: {
        operationId: 'patchTitleMine',
        tags: ['Titles'],
        params: titleParams,
        querystring: titleMineQuery,
        body: updateTitleMine,
        response: { 200: titleMine, 404: messageResponse, ...guardResponses },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      updateMine(request.profileId, request.params.id, request.body)

      return getTitleMine(
        request.profileId,
        request.params.id,
        request.query.language,
      )
    },
  )
}
