import { preparePlayedSource } from '../services/sources/playedSource.ts'
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from 'fastify-type-provider-zod'
import type { Item } from '../services/jellyfin/library.ts'
import type {
  LaunchSelection,
  TitleRef,
} from '../services/sources/progress.ts'
import type { PreparedPlayedSource } from '../services/sources/playedSource.ts'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { markStreaming, revokeDevice } from '../services/devices/index.ts'
import {
  COMPATIBILITY_VERSION,
  issueDevice,
  requireJellyfin,
  serverId,
  userDto,
} from '../services/jellyfin/auth.ts'
import { body, params, query } from '../services/jellyfin/dto.ts'
import {
  descendants,
  isFolder,
  itemDto,
  listDto,
  mediaSource,
  progressOf,
  progressRef,
  projectLibrary,
  sourceId,
  userData,
} from '../services/jellyfin/library.ts'
import { sendLibraryFile } from '../services/library/stream.ts'
import { cachedThumb } from '../services/library/thumbs.ts'
import { voiceOfTrack } from '../services/media/decide.ts'
import { summaryOf } from '../services/mine/cards.ts'
import { clearMovieWatchlist, updateMine } from '../services/mine/index.ts'
import {
  getTitleProgress,
  launchSelectionOf,
  markWatched,
  rememberStartedSource,
  sameTitleRef,
  saveTitleProgress,
} from '../services/sources/progress.ts'
import { fetchTmdbImage } from '../services/tmdb/index.ts'
import { isWatched } from '../services/torrents/playback.ts'
import { verifyOwnerCredentials } from '../services/users/credentials.ts'

const PLAYBACK_CONTEXT_LIMIT = 256
const PLAYBACK_CONTEXT_IDLE_MS = 2 * 60 * 1000
interface PlaybackContext {
  launch?: LaunchSelection
  expiresAt: number
  fileId?: string
  evidence?: Promise<PreparedPlayedSource>
}

function playbackKey(
  device: string,
  profile: string,
  item: string,
  id: string,
) {
  return JSON.stringify([device, profile, item, id])
}

async function projectPlaybackItem(
  profileId: string,
  id: string,
  captureLaunch: boolean,
) {
  let baseline: { ref: TitleRef, launch: LaunchSelection } | undefined
  const projection = await projectLibrary(
    profileId,
    id,
    captureLaunch
      ? (ref) => {
          baseline = {
            ref,
            launch: launchSelectionOf(ref, getTitleProgress(ref)),
          }
        }
      : undefined,
  )
  const item = projection.items.get(id)
  const launch
    = item && baseline && sameTitleRef(progressRef(item, profileId), baseline.ref)
      ? baseline.launch
      : undefined
  return { item, launch }
}

/** Exact routes only: the native API and showcase SPA keep their own namespace. */
export const jellyfinRoutes: FastifyPluginAsyncZod = async (app) => {
  const schema = { hide: true, querystring: query, params }
  const playbacks = new Map<string, PlaybackContext>()
  function keepPlayback(
    key: string,
    launch?: LaunchSelection,
    fileId?: string,
    evidence?: Promise<PreparedPlayedSource>,
  ) {
    const now = Date.now()
    playbacks.delete(key)
    for (const [oldKey, state] of playbacks) {
      if (state.expiresAt > now && playbacks.size < PLAYBACK_CONTEXT_LIMIT)
        break
      playbacks.delete(oldKey)
    }
    playbacks.set(key, {
      launch,
      expiresAt: now + PLAYBACK_CONTEXT_IDLE_MS,
      fileId,
      evidence,
    })
  }
  for (const prefix of ['', '/emby']) {
    for (const path of ['/System/Info/Public', '/System/Info']) {
      app.get(
        `${prefix}${path}`,
        {
          schema,
          ...(path.endsWith('/Public') ? {} : { onRequest: requireJellyfin }),
        },
        async () => ({
          LocalAddress: '',
          ServerName: 'Torsher',
          Version: COMPATIBILITY_VERSION,
          ProductName: 'Torsher',
          Id: serverId(),
          StartupWizardCompleted: true,
        }),
      )
    }
    for (const method of ['GET', 'POST'] as const) {
      app.route({
        method,
        url: `${prefix}/System/Ping`,
        schema,
        handler: async (_request, reply) =>
          reply.type('text/plain').send('Jellyfin Server'),
      })
    }
    app.get(`${prefix}/Users/Public`, { schema }, async () => [])
    app.post(
      `${prefix}/Users/AuthenticateByName`,
      { schema: { ...schema, body } },
      async (request, reply) => {
        if (
          request.body?.Username === undefined
          || request.body.Pw === undefined
        ) {
          return reply
            .code(400)
            .send({ message: 'Username and Pw are required' })
        }
        const result = await verifyOwnerCredentials(
          { username: request.body.Username, password: request.body.Pw },
          request.ip,
        )
        if (!result.ok) {
          if (result.retryAfter !== undefined)
            reply.header('Retry-After', String(result.retryAfter))
          return reply.code(result.status).send({ message: result.message })
        }
        const { device, token, fields } = issueDevice(
          request,
          result.user.sessionVersion,
        )
        return {
          User: userDto(device.profileId!),
          AccessToken: token,
          ServerId: serverId(),
          SessionInfo: {
            Id: device.id.replaceAll('-', ''),
            UserId: device.profileId!.replaceAll('-', ''),
            UserName: userDto(device.profileId!).Name,
            Client: fields.client ?? 'Jellyfin-compatible player',
            DeviceName: fields.device ?? device.name,
            DeviceId: fields.deviceid ?? device.id,
            ApplicationVersion: fields.version ?? '',
            ServerId: serverId(),
            SupportsRemoteControl: false,
            PlayState: { CanSeek: true, IsPaused: false, IsMuted: false },
          },
        }
      },
    )

    // Each protected route uses the same hook, including auto-created HEAD routes.
    app.register(async (instance) => {
      const protectedApp = instance.withTypeProvider<ZodTypeProvider>()
      protectedApp.addHook('onRequest', requireJellyfin)
      protectedApp.addHook('preHandler', async (request, reply) => {
        const path = request.params as Record<string, string>
        const input = request.body as { UserId?: string } | undefined
        const q = request.query as { userid?: string }
        const own = request.profileId.replaceAll('-', '')
        if (
          [path.userId, q.userid, input?.UserId].some(
            id => id !== undefined && id.replaceAll('-', '') !== own,
          )
        ) {
          return reply
            .code(403)
            .send({ message: 'User does not match the authenticated profile' })
        }
      })
      for (const path of ['/Users/Me', '/Users/:userId']) {
        protectedApp.get(`${prefix}${path}`, { schema }, async request =>
          userDto(request.profileId))
      }
      protectedApp.post(
        `${prefix}/Sessions/Logout`,
        { schema },
        async (request, reply) => {
          revokeDevice(request.deviceId!)
          return reply.code(204).send()
        },
      )
      for (const path of [
        '/Sessions/Capabilities',
        '/Sessions/Capabilities/Full',
        '/Sessions/Playing/Ping',
      ]) {
        protectedApp.post(
          `${prefix}${path}`,
          { schema: { ...schema, body } },
          async (_request, reply) => reply.code(204).send(),
        )
      }
      protectedApp.get(`${prefix}/Persons`, { schema }, async request => ({
        Items: [],
        TotalRecordCount: 0,
        StartIndex: request.query.startindex,
      }))
      // Torsher exposes fixed views and offers no user-configurable grouping.
      protectedApp.get(
        `${prefix}/UserViews/GroupingOptions`,
        { schema },
        async () => [],
      )
      protectedApp.get(
        `${prefix}/DisplayPreferences/usersettings`,
        { schema },
        async request => ({
          Id: 'usersettings',
          Client:
            typeof request.query.client === 'string'
              ? request.query.client
              : undefined,
          CustomPrefs: {},
          RememberIndexing: false,
          RememberSorting: false,
          ShowBackdrop: true,
          ShowSidebar: false,
          PrimaryImageWidth: 250,
          PrimaryImageHeight: 250,
          SortOrder: 'Ascending',
          ScrollDirection: 'Horizontal',
        }),
      )
      protectedApp.get(
        `${prefix}/Library/VirtualFolders`,
        { schema },
        async (request) => {
          const projection = await projectLibrary(request.profileId)
          return [...projection.items.values()]
            .filter(item => item.type === 'CollectionFolder')
            .map(view => ({
              Name: view.name,
              ItemId: view.id,
              CollectionType: view.collectionType,
              Locations: [],
            }))
        },
      )
      protectedApp.get(
        `${prefix}/Items/Counts`,
        { schema },
        async (request) => {
          const { items } = await projectLibrary(request.profileId)
          const counts = {
            MovieCount: 0,
            SeriesCount: 0,
            EpisodeCount: 0,
            ItemCount: 0,
          }
          for (const item of items.values()) {
            if (item.type === 'Movie')
              counts.MovieCount++
            if (item.type === 'Series')
              counts.SeriesCount++
            if (item.type === 'Episode')
              counts.EpisodeCount++
            if (item.type !== 'CollectionFolder')
              counts.ItemCount++
          }
          return counts
        },
      )
      for (const path of ['/Users/:userId/Views', '/UserViews']) {
        protectedApp.get(`${prefix}${path}`, { schema }, async (request) => {
          const projection = await projectLibrary(request.profileId)
          return listDto(
            projection,
            request.query,
            [...projection.items.values()].filter(
              item => item.type === 'CollectionFolder',
            ),
          )
        })
      }
      for (const path of [
        '/Items',
        '/Users/:userId/Items',
        '/Users/:userId/Items/Resume',
        '/Items/Resume',
        '/UserItems/Resume',
        '/Users/:userId/Items/Latest',
        '/Items/Latest',
      ]) {
        protectedApp.get(`${prefix}${path}`, { schema }, async (request) => {
          const projection = await projectLibrary(request.profileId)
          const resume = path.endsWith('/Resume')
          const latest = path.endsWith('/Latest')
          const q = { ...request.query }
          let candidates: Item[] | undefined
          if (resume || latest) {
            q.recursive = true
            candidates = [...projection.items.values()].filter(
              item => !isFolder(item),
            )
            if (resume) {
              candidates = candidates.filter((item) => {
                const progress = progressOf(item, projection)
                return progress && progress.position > 0 && !progress.watchedAt
              })
            }
            q.sortby ??= resume ? 'DatePlayed' : 'DateCreated'
            q.sortorder ??= 'Descending'
          }
          const result = await listDto(projection, q, candidates)
          return latest ? result.Items : result
        })
      }
      for (const path of ['/Items/:id', '/Users/:userId/Items/:id']) {
        protectedApp.get(
          `${prefix}${path}`,
          { schema },
          async (request, reply) => {
            const projection = await projectLibrary(request.profileId)
            const item = projection.items.get(request.params.id!)
            return item
              ? itemDto(item, projection)
              : reply.code(404).send({ message: 'Item not found' })
          },
        )
      }
      for (const path of [
        '/Shows/:id/Seasons',
        '/Shows/:id/Episodes',
        '/Shows/NextUp',
      ]) {
        protectedApp.get(
          `${prefix}${path}`,
          { schema },
          async (request, reply) => {
            const projection = await projectLibrary(request.profileId)
            const seriesId = request.params.id ?? request.query.seriesid
            if (seriesId && projection.items.get(seriesId)?.type !== 'Series')
              return reply.code(404).send({ message: 'Series not found' })
            let candidates = [...projection.items.values()].filter(
              item =>
                item.type
                === (path.endsWith('/Seasons') ? 'Season' : 'Episode'),
            )
            if (seriesId) {
              candidates = candidates.filter(
                item => item.seriesId === seriesId,
              )
            }
            if (request.query.seasonid) {
              candidates = candidates.filter(
                item => item.parentId === request.query.seasonid,
              )
            }
            if (request.query.season !== undefined) {
              candidates = candidates.filter(
                item => item.season === request.query.season,
              )
            }
            if (path.endsWith('/NextUp')) {
              const grouped = new Map<string, Item[]>()
              for (const item of candidates) {
                const list = grouped.get(item.seriesId!) ?? []
                list.push(item)
                grouped.set(item.seriesId!, list)
              }
              candidates = []
              for (const list of grouped.values()) {
                list.sort(
                  (a, b) => a.season! - b.season! || a.episode! - b.episode!,
                )
                // Only series already started; keep a resumable episode ahead of the next unseen one.
                if (
                  !list.some((item) => {
                    const progress = progressOf(item, projection)
                    return (
                      progress && (progress.position > 0 || progress.watchedAt)
                    )
                  })
                ) {
                  continue
                }
                const next = list.find(
                  item => !progressOf(item, projection)?.watchedAt,
                )
                if (next)
                  candidates.push(next)
              }
            }
            return listDto(
              projection,
              {
                ...request.query,
                recursive: true,
                sortby: request.query.sortby ?? 'ParentIndexNumber,IndexNumber',
              },
              candidates,
            )
          },
        )
      }
      for (const method of ['GET', 'POST'] as const) {
        protectedApp.route({
          method,
          url: `${prefix}/Items/:id/PlaybackInfo`,
          schema: { ...schema, ...(method === 'POST' ? { body } : {}) },
          handler: async (request, reply) => {
            const { item, launch } = await projectPlaybackItem(
              request.profileId,
              request.params.id!,
              true,
            )
            const requested
              = body.parse(request.body)?.MediaSourceId
                ?? request.query.mediasourceid
            const sources
              = item?.sources.filter(
                file => !requested || sourceId(file) === requested,
              ) ?? []
            if (!item || !sources.length) {
              return reply
                .code(404)
                .send({ message: 'Media source not found' })
            }
            const id = randomUUID().replaceAll('-', '')
            keepPlayback(
              playbackKey(request.deviceId!, request.profileId, item.id, id),
              launch,
              sources.length === 1 ? sources[0]!.id : undefined,
            )
            return {
              MediaSources: sources.map(file => mediaSource(item, file)),
              PlaySessionId: id,
            }
          },
        })
      }
      for (const path of [
        '/Videos/:id/stream',
        '/Videos/:id/stream.:extension',
        '/videos/:id/stream',
        '/videos/:id/stream.:extension',
      ]) {
        protectedApp.get(
          `${prefix}${path}`,
          { schema },
          async (request, reply) => {
            if (request.query.static === false) {
              return reply
                .code(400)
                .send({ message: 'Only static direct play is available' })
            }
            const projection = await projectLibrary(
              request.profileId,
              request.params.id,
            )
            const item = projection.items.get(request.params.id!)
            const file = request.query.mediasourceid
              ? item?.sources.find(
                  file => sourceId(file) === request.query.mediasourceid,
                )
              : item?.sources[0]
            if (!file) {
              return reply
                .code(404)
                .send({ message: 'Media source not found' })
            }
            markStreaming(request.deviceId!)
            return sendLibraryFile(request, reply, file.id, request.profileId)
          },
        )
      }
      for (const path of [
        '/Items/:id/Images/:type',
        '/Items/:id/Images/:type/:index',
      ]) {
        protectedApp.get(
          `${prefix}${path}`,
          { schema },
          async (request, reply) => {
            if (
              !['Primary', 'Backdrop'].includes(request.params.type!)
              || (request.params.index !== undefined
                && request.params.index !== '0')
            ) {
              return reply.code(404).send({ message: 'Image not found' })
            }
            const projection = await projectLibrary(request.profileId)
            const item = projection.items.get(request.params.id!)
            if (!item)
              return reply.code(404).send({ message: 'Item not found' })
            const details
              = item.details
                ?? (item.titleId
                  ? (await summaryOf(item.titleId, projection.language))?.details
                  : undefined)
            const image
              = request.params.type === 'Backdrop'
                ? details?.backdrop
                : details?.poster
            const match
              = image
                && /^\/api\/img\/(\w+)\/([\w-]+\.(?:jpg|jpeg|png|webp))$/.exec(
                  image,
                )
            if (match) {
              try {
                const upstream = await fetchTmdbImage(match[1]!, match[2]!)
                if (
                  !upstream.ok
                  || !upstream.body
                  || !upstream.headers.get('content-type')?.startsWith('image/')
                ) {
                  return reply.code(404).send({ message: 'Image unavailable' })
                }
                const extension = match[2]!.split('.').pop()!
                return reply
                  .header(
                    'Content-Type',
                    `image/${extension === 'jpg' ? 'jpeg' : extension}`,
                  )
                  .header('Cache-Control', 'private, no-store')
                  .header('X-Content-Type-Options', 'nosniff')
                  .send(Readable.fromWeb(upstream.body))
              }
              catch {
                return reply.code(502).send({ message: 'Image unavailable' })
              }
            }
            const thumb
              = request.params.type === 'Primary'
                && item.sources[0]
                && (await cachedThumb(item.sources[0]))
            if (!thumb)
              return reply.code(404).send({ message: 'Image not found' })
            return reply
              .type('image/jpeg')
              .header('Cache-Control', 'private, no-store')
              .send(createReadStream(thumb))
          },
        )
      }
      for (const path of [
        '/Sessions/Playing',
        '/Sessions/Playing/Progress',
        '/Sessions/Playing/Stopped',
      ]) {
        protectedApp.post(
          `${prefix}${path}`,
          { schema: { ...schema, body } },
          async (request, reply) => {
            const input = request.body
            const starting = path === '/Sessions/Playing'
            const id = input?.PlaySessionId
            const item = input?.ItemId
              ? await projectPlaybackItem(
                  request.profileId,
                  input.ItemId,
                  starting && id === undefined,
                )
              : undefined
            const target = item?.item
            if (!target?.sources.length) {
              return reply
                .code(404)
                .send({ message: 'Media source not found' })
            }
            const ref = progressRef(target, request.profileId)
            const previous = getTitleProgress(ref)
            const key
              = id === undefined
                ? undefined
                : playbackKey(
                    request.deviceId!,
                    request.profileId,
                    target.id,
                    id,
                  )
            const cached = key && playbacks.get(key)
            const bound
              = cached && cached.expiresAt > Date.now() ? cached : undefined
            const confirmed = input?.MediaSourceId
              ? target.sources.find(
                  file => sourceId(file) === input.MediaSourceId,
                )
              : (target.sources.find(file => file.id === bound?.fileId)
                ?? (target.sources.length === 1 ? target.sources[0] : undefined))
            if (input?.MediaSourceId && !confirmed) {
              return reply
                .code(404)
                .send({ message: 'Media source not found' })
            }
            const source = {
              mediaFileId: confirmed?.id ?? null,
              torrentId: confirmed?.torrentId ?? null,
              fileIndex: confirmed?.fileIndex ?? null,
            }
            let launch: LaunchSelection | undefined
            let evidence: Promise<PreparedPlayedSource> | undefined
            if (
              confirmed
              && key
              && bound
              && (!bound.fileId || bound.fileId === confirmed.id)
            ) {
              launch = bound.launch
              evidence
                = bound.evidence
                  ?? preparePlayedSource(source).then(prepared =>
                    prepared?.contentKey ? prepared : { ref: source },
                  )
              keepPlayback(key, launch, confirmed.id, evidence)
            }
            else if (starting && id === undefined && confirmed) {
              launch = item?.launch
            }
            const position
              = input?.PositionTicks === undefined
                ? previous?.position
                : input.PositionTicks / 10_000_000
            const duration
              = confirmed?.duration
                ?? (input?.RunTimeTicks === undefined
                  ? !confirmed || previous?.mediaFileId === confirmed.id
                      ? (previous?.duration ?? null)
                      : null
                  : input.RunTimeTicks / 10_000_000)
            if (starting && input?.PositionTicks === undefined) {
              if (evidence)
                await evidence
              if (launch)
                rememberStartedSource(ref, source, launch)
            }
            else if (
              position !== undefined
              && (confirmed || input?.PositionTicks !== undefined)
            ) {
              const preparedSource = await (evidence
                ?? preparePlayedSource(source))
              const track = preparedSource?.audio?.find(
                track => track.index === input?.AudioStreamIndex,
              )
              const voice = track && voiceOfTrack(track)
              saveTitleProgress(
                ref,
                { ...source, position, duration },
                undefined,
                confirmed ? preparedSource : 'unknown',
                voice?.studio || voice?.type
                  ? { studio: voice.studio, type: voice.type }
                  : null,
                launch,
              )
              if (target.type === 'Movie' && isWatched(position, duration))
                clearMovieWatchlist(request.profileId, target.titleId!)
            }
            if (!path.endsWith('/Stopped'))
              markStreaming(request.deviceId!)
            return reply.code(204).send()
          },
        )
      }
      for (const [path, action] of [
        ['/UserPlayedItems/:id', 'PlayedItems'],
        ['/Users/:userId/PlayedItems/:id', 'PlayedItems'],
        ['/UserFavoriteItems/:id', 'FavoriteItems'],
        ['/Users/:userId/FavoriteItems/:id', 'FavoriteItems'],
      ] as const) {
        for (const method of ['POST', 'DELETE'] as const) {
          protectedApp.route({
            method,
            url: `${prefix}${path}`,
            schema,
            handler: async (request, reply) => {
              let projection = await projectLibrary(request.profileId)
              const item = projection.items.get(request.params.id!)
              if (!item)
                return reply.code(404).send({ message: 'Item not found' })
              if (action === 'FavoriteItems') {
                if (!item.titleId) {
                  return reply
                    .code(400)
                    .send({ message: 'Favorites require a catalog title' })
                }
                updateMine(request.profileId, item.titleId, {
                  favorite: method === 'POST',
                })
              }
              else {
                const targets = isFolder(item)
                  ? descendants(item, projection).filter(
                      child => !isFolder(child),
                    )
                  : [item]
                for (const target of targets) {
                  markWatched(
                    progressRef(target, request.profileId),
                    method === 'POST',
                  )
                  if (method === 'POST' && target.type === 'Movie')
                    clearMovieWatchlist(request.profileId, target.titleId!)
                }
              }
              projection = await projectLibrary(request.profileId)
              return userData(item, projection)
            },
          })
        }
      }
    })
  }
}
