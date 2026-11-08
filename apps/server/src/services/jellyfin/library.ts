import type { MediaFile, TitleProgress } from '../../db/schema.ts'
import type { TitleDetails } from '../../dto/catalog.ts'
import type { Query } from './dto.ts'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  profileTitles,
  titleProgress,
} from '../../db/schema.ts'
import { mapLimit } from '../../utils/mapLimit.ts'
import { absolutePathOf, fileProgressId } from '../library/files.ts'
import { hiddenLibraryIds } from '../library/folders.ts'
import { summaryOf } from '../mine/cards.ts'
import { getProfile } from '../profiles/index.ts'
import { cachedTitleDetails } from '../tmdb/index.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { serverId } from './auth.ts'
import { allowedTitleIds, hasAgeLimit } from '../profiles/access.ts'

export type ItemType
  = 'CollectionFolder' | 'Movie' | 'Series' | 'Season' | 'Episode' | 'Video'
export interface Item {
  id: string
  type: ItemType
  name: string
  parentId?: string
  libraryId: string
  collectionType?: string
  titleId?: string
  season?: number
  episode?: number
  episodeTo?: number
  seriesId?: string
  sources: MediaFile[]
  addedAt: number
  details?: TitleDetails
}
export function itemId(...parts: (string | number)[]) {
  return createHash('sha256')
    .update(JSON.stringify(['torsher:jellyfin:v1', ...parts]))
    .digest('hex')
    .slice(0, 32)
}
export const sourceId = (file: MediaFile) => file.id.replaceAll('-', '')
export const ticksOf = (seconds: number) => Math.round(seconds * 10_000_000)
export function isFolder(item: Item) {
  return ['CollectionFolder', 'Series', 'Season'].includes(item.type)
}
export function progressKey(titleId: string, season = 0, episode = 0) {
  return JSON.stringify([titleId, season, episode])
}
export function progressRef(item: Item, profileId: string) {
  return {
    profileId,
    titleId: item.titleId ?? fileProgressId(item.sources[0]!.id),
    season: item.season,
    episode: item.episode,
  }
}

/** Request-local projection: visibility and availability precede grouping and counts. */
function identity(file: MediaFile, libraryId: string, home: boolean) {
  const ref = home ? undefined : parseCatalogId(file.titleId ?? '')
  const matched = !!ref && file.matchStatus === 'matched'
  const episode
    = matched
      && ref.type === 'tv'
      && file.season !== null
      && file.episode !== null
  const type: ItemType
    = matched && ref.type === 'movie' ? 'Movie' : episode ? 'Episode' : 'Video'
  const id
    = type === 'Video'
      ? itemId(type, libraryId, file.id)
      : type === 'Movie'
        ? itemId(type, libraryId, file.titleId!)
        : itemId(
            type,
            libraryId,
            file.titleId!,
            file.season!,
            file.episode!,
            file.episodeTo ?? file.episode!,
          )
  return { type, id }
}

export async function projectLibrary(profileId: string, targetItemId?: string) {
  const db = getDb()
  const language
    = getProfile(profileId)?.language?.replace('_', '-') ?? 'en-US'
  const hidden = new Set(hiddenLibraryIds(profileId))
  const folders = db
    .select({ folder: libraryFolders, library: libraries })
    .from(libraryFolders)
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .all()
    .filter(row => !hidden.has(row.library.id) && row.folder.status === 'ok')
  const byFolder = new Map(folders.map(row => [row.folder.id, row]))
  const rows = db
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.state, 'present'))
    .all()
    .filter((file) => {
      const folder = byFolder.get(file.folderId)
      return (
        folder
        && file.matchStatus !== 'ignored'
        && (!targetItemId
          || identity(file, folder.library.id, folder.library.kind === 'home')
            .id === targetItemId)
      )
    })
  const allowed = await allowedTitleIds(
    profileId,
    rows
      .filter(
        file =>
          byFolder.get(file.folderId)?.library.kind !== 'home'
          && file.matchStatus === 'matched',
      )
      .map(file => file.titleId),
  )
  const visible = hasAgeLimit(profileId)
    ? rows.filter(
        file =>
          byFolder.get(file.folderId)?.library.kind !== 'home'
          && file.matchStatus === 'matched'
          && !!file.titleId
          && allowed.has(file.titleId),
      )
    : rows
  const available = await mapLimit(visible, 16, async (file) => {
    const info = await stat(
      absolutePathOf(byFolder.get(file.folderId)!.folder, file),
    ).catch(() => undefined)
    return info?.isFile() ? file : undefined
  })
  const items = new Map<string, Item>()
  const details = new Map<string, TitleDetails | undefined>()
  const put = (item: Item) => {
    const prior = items.get(item.id)
    if (prior) {
      prior.sources.push(...item.sources)
      prior.addedAt = Math.max(prior.addedAt, item.addedAt)
      return prior
    }
    items.set(item.id, item)
    return item
  }
  for (const file of available) {
    if (!file)
      continue
    const { library } = byFolder.get(file.folderId)!
    const { type, id } = identity(file, library.id, library.kind === 'home')
    const collectionType
      = type === 'Movie'
        ? 'movies'
        : type === 'Episode'
          ? 'tvshows'
          : 'homevideos'
    const viewId = itemId('view', library.id, collectionType)
    put({
      id: viewId,
      type: 'CollectionFolder',
      name: library.name,
      libraryId: library.id,
      collectionType,
      sources: [],
      addedAt: 0,
    })
    const titleId = type === 'Video' ? undefined : file.titleId!
    if (titleId && !details.has(titleId))
      details.set(titleId, cachedTitleDetails(titleId, language))
    const metadata = titleId ? details.get(titleId) : undefined
    const fallback = basename(file.relPath, extname(file.relPath))
    let parentId = viewId
    let seriesId: string | undefined
    if (type === 'Episode') {
      seriesId = itemId('Series', library.id, titleId!)
      put({
        id: seriesId,
        type: 'Series',
        name: metadata?.title ?? titleId!,
        parentId: viewId,
        libraryId: library.id,
        titleId,
        sources: [],
        addedAt: file.addedAt.getTime(),
        details: metadata,
      })
      parentId = itemId('Season', library.id, titleId!, file.season!)
      put({
        id: parentId,
        type: 'Season',
        name: file.season === 0 ? 'Specials' : `Season ${file.season}`,
        parentId: seriesId,
        seriesId,
        libraryId: library.id,
        titleId,
        season: file.season!,
        sources: [],
        addedAt: file.addedAt.getTime(),
        details: metadata,
      })
    }
    put({
      id,
      type,
      name: type === 'Movie' ? (metadata?.title ?? fallback) : fallback,
      parentId,
      seriesId,
      libraryId: library.id,
      titleId,
      season: type === 'Episode' ? file.season! : undefined,
      episode: type === 'Episode' ? file.episode! : undefined,
      episodeTo: type === 'Episode' ? (file.episodeTo ?? undefined) : undefined,
      sources: [file],
      addedAt: file.addedAt.getTime(),
      details: metadata,
    })
  }
  const progress = new Map(
    db
      .select()
      .from(titleProgress)
      .where(eq(titleProgress.profileId, profileId))
      .all()
      .map(row => [progressKey(row.titleId, row.season, row.episode), row]),
  )
  const childrenByParent = new Map<string, Item[]>()
  const viewsByLibrary = new Map<string, Item[]>()
  for (const item of items.values()) {
    if (item.sources.length > 1 && item.titleId) {
      const saved = progress.get(
        progressKey(item.titleId, item.season, item.episode),
      )
      const preferred
        = saved && saved.position > 0 ? saved.mediaFileId : undefined
      // Clients use the first source for resume unless the viewer chooses another version.
      item.sources.sort(
        (a, b) =>
          Number(b.id === preferred) - Number(a.id === preferred)
          || a.id.localeCompare(b.id),
      )
    }
    if (item.parentId) {
      const children = childrenByParent.get(item.parentId) ?? []
      children.push(item)
      childrenByParent.set(item.parentId, children)
    }
    if (item.type === 'CollectionFolder') {
      const views = viewsByLibrary.get(item.libraryId) ?? []
      views.push(item)
      viewsByLibrary.set(item.libraryId, views)
    }
  }
  for (const views of viewsByLibrary.values()) {
    if (views.length > 1) {
      for (const item of views)
        item.name += ` — ${item.collectionType === 'movies' ? 'Movies' : item.collectionType === 'tvshows' ? 'TV shows' : 'Videos'}`
    }
  }
  const favorites = new Set(
    db
      .select()
      .from(profileTitles)
      .where(eq(profileTitles.profileId, profileId))
      .all()
      .filter(row => row.favoriteAt)
      .map(row => row.titleId),
  )
  return {
    items,
    childrenByParent,
    descendantCache: new Map<string, Item[]>(),
    progress,
    favorites,
    profileId,
    language,
  }
}
export type Projection = Awaited<ReturnType<typeof projectLibrary>>

export function progressOf(
  item: Item,
  projection: Projection,
): TitleProgress | undefined {
  if (isFolder(item))
    return undefined
  const ref = progressRef(item, projection.profileId)
  return projection.progress.get(
    progressKey(ref.titleId, ref.season, ref.episode),
  )
}
export function descendants(item: Item, projection: Projection): Item[] {
  const cached = projection.descendantCache.get(item.id)
  if (cached)
    return cached
  const children = projection.childrenByParent.get(item.id) ?? []
  const result = children.flatMap(child => [
    child,
    ...descendants(child, projection),
  ])
  projection.descendantCache.set(item.id, result)
  return result
}
export function userData(item: Item, projection: Projection) {
  const progress = progressOf(item, projection)
  const children = isFolder(item)
    ? descendants(item, projection).filter(child => !isFolder(child))
    : []
  const played = children.length
    ? children.every(child => !!progressOf(child, projection)?.watchedAt)
    : !!progress?.watchedAt
  return {
    Key: item.id,
    ItemId: item.id,
    IsFavorite: !!item.titleId && projection.favorites.has(item.titleId),
    Played: played,
    PlayCount: played ? 1 : 0,
    PlaybackPositionTicks: ticksOf(progress?.position ?? 0),
    LastPlayedDate: progress?.updatedAt?.toISOString(),
    PlayedPercentage: progress?.duration
      ? Math.min(100, (progress.position / progress.duration) * 100)
      : 0,
    ...(children.length
      ? {
          UnplayedItemCount: children.filter(
            child => !progressOf(child, projection)?.watchedAt,
          ).length,
        }
      : {}),
  }
}

// Clients use the local media name to browse files. Keep server directories private.
function clientFilePath(file: MediaFile) {
  return `/Torsher/${sourceId(file)}/${basename(file.relPath)}`
}

export function mediaSource(item: Item, file: MediaFile) {
  const probe = file.probe
  const streams = [
    ...(probe?.video
      ? [
          {
            Type: 'Video',
            Index: probe.video.index,
            Codec: probe.video.codec,
            Width: probe.video.width,
            Height: probe.video.height,
            BitRate: probe.video.bitrate,
            RealFrameRate: probe.video.frameRate,
            VideoRange: probe.video.hdr ? 'HDR' : 'SDR',
          },
        ]
      : []),
    ...(probe?.audio.map(audio => ({
      Type: 'Audio',
      Index: audio.index,
      Codec: audio.codec,
      Language: audio.language,
      DisplayTitle: audio.title ?? audio.codec,
      Channels: audio.channels,
      BitRate: audio.bitrate,
      IsDefault: audio.default,
    })) ?? []),
    ...(probe?.subtitles.map(subtitle => ({
      Type: 'Subtitle',
      Index: subtitle.index,
      Codec: subtitle.codec,
      Language: subtitle.language,
      DisplayTitle: subtitle.title ?? subtitle.codec,
      IsDefault: subtitle.default,
      IsForced: subtitle.forced,
      IsExternal: false,
      DeliveryMethod: 'Embed',
    })) ?? []),
  ]
  const container
    = probe?.container && probe.container !== 'other'
      ? probe.container
      : extname(file.relPath).slice(1).toLowerCase()
  return {
    Id: sourceId(file),
    ItemId: item.id,
    Name: file.version ?? container.toUpperCase(),
    Type: 'Default',
    Protocol: 'File',
    Path: clientFilePath(file),
    Container: container,
    Size: file.size,
    RunTimeTicks: file.duration === null ? undefined : ticksOf(file.duration),
    SupportsDirectPlay: true,
    SupportsDirectStream: false,
    SupportsTranscoding: false,
    IsRemote: false,
    ReadAtNativeFramerate: false,
    MediaStreams: streams,
    DefaultAudioStreamIndex:
      probe?.audio.find(audio => audio.default)?.index
      ?? probe?.audio[0]?.index,
    DefaultSubtitleStreamIndex:
      probe?.subtitles.find(subtitle => subtitle.default)?.index ?? -1,
  }
}

export async function itemDto(item: Item, projection: Projection, load = true) {
  const details
    = item.details
      ?? (load && item.titleId
        ? (await summaryOf(item.titleId, projection.language))?.details
        : undefined)
  const children = projection.childrenByParent.get(item.id) ?? []
  const data = userData(item, projection)
  const file = item.sources[0]
  return {
    Id: item.id,
    ServerId: serverId(),
    Name: ['Movie', 'Series'].includes(item.type)
      ? (details?.title ?? item.name)
      : item.name,
    OriginalTitle: details?.originalTitle,
    SortName: item.name,
    Type: item.type,
    IsFolder: isFolder(item),
    MediaType: isFolder(item) ? undefined : 'Video',
    LocationType: 'FileSystem',
    Path: file ? clientFilePath(file) : undefined,
    ParentId: item.parentId,
    CollectionType: item.collectionType,
    DateCreated: new Date(item.addedAt).toISOString(),
    Overview: details?.overview,
    ProductionYear: details?.year,
    ProviderIds: item.titleId
      ? { Tmdb: String(parseCatalogId(item.titleId)?.tmdbId) }
      : {},
    ImageTags: details?.poster
      ? { Primary: itemId(details.poster) }
      : file?.thumb
        ? { Primary: itemId(file.thumb) }
        : {},
    BackdropImageTags: details?.backdrop ? [itemId(details.backdrop)] : [],
    SeriesId: item.seriesId,
    SeriesName: item.seriesId
      ? projection.items.get(item.seriesId)?.name
      : undefined,
    SeasonId: item.type === 'Episode' ? item.parentId : undefined,
    IndexNumber: item.episode ?? item.season,
    IndexNumberEnd: item.episodeTo,
    ParentIndexNumber: item.type === 'Episode' ? item.season : undefined,
    ChildCount: isFolder(item) ? children.length : undefined,
    RecursiveItemCount: isFolder(item)
      ? descendants(item, projection).filter(child => !isFolder(child)).length
      : undefined,
    RunTimeTicks: file?.duration ? ticksOf(file.duration) : undefined,
    Container: file ? mediaSource(item, file).Container : undefined,
    MediaSources: item.sources.map(source => mediaSource(item, source)),
    MediaStreams: file ? mediaSource(item, file).MediaStreams : undefined,
    UserData: data,
    CanDownload: false,
    PlayAccess: 'Full',
  }
}

const split = (value?: string) => value?.split(',').filter(Boolean)
export function selectItems(
  projection: Projection,
  query: Query,
  candidates = [...projection.items.values()],
) {
  let items = candidates
  if (query.parentid) {
    const parent = projection.items.get(query.parentid)
    const permitted = new Set(
      parent
        ? (query.recursive
            ? descendants(parent, projection)
            : (projection.childrenByParent.get(parent.id) ?? [])
          ).map(item => item.id)
        : [],
    )
    items = items.filter(item => permitted.has(item.id))
  }
  else if (
    !query.recursive
    && !query.ids
    && !query.includeitemtypes
    && !query.searchterm
  ) {
    items = items.filter(item => !item.parentId)
  }
  if (query.ids)
    items = items.filter(item => split(query.ids)!.includes(item.id))
  if (query.includeitemtypes) {
    items = items.filter(item =>
      split(query.includeitemtypes)!.includes(item.type),
    )
  }
  if (query.excludeitemtypes) {
    items = items.filter(
      item => !split(query.excludeitemtypes)!.includes(item.type),
    )
  }
  if (query.mediatypes) {
    items = items.filter(
      item => !isFolder(item) && split(query.mediatypes)!.includes('Video'),
    )
  }
  if (query.searchterm) {
    const term = query.searchterm.toLocaleLowerCase()
    items = items.filter(item =>
      `${item.name} ${item.details?.originalTitle ?? ''}`
        .toLocaleLowerCase()
        .includes(term),
    )
  }
  const filters = new Set(split(query.filters))
  items = items.filter((item) => {
    const data = userData(item, projection)
    return (
      (query.isplayed === undefined || query.isplayed === data.Played)
      && (query.isfolder === undefined || query.isfolder === isFolder(item))
      && (!filters.has('IsFolder') || isFolder(item))
      && (!filters.has('IsNotFolder') || !isFolder(item))
      && (query.isfavorite === undefined
        || query.isfavorite === data.IsFavorite)
      && (!filters.has('IsPlayed') || data.Played)
      && (!filters.has('IsUnplayed') || !data.Played)
      && (!filters.has('IsFavorite') || data.IsFavorite)
      && (!filters.has('IsResumable')
        || (!data.Played && data.PlaybackPositionTicks > 0))
    )
  })
  const sorts = split(query.sortby) ?? ['SortName']
  const value = (item: Item, key: string): string | number =>
    key === 'DateCreated'
      ? item.addedAt
      : key === 'DatePlayed'
        ? (progressOf(item, projection)?.updatedAt.getTime() ?? 0)
        : key === 'IndexNumber'
          ? (item.episode ?? item.season ?? 0)
          : key === 'ParentIndexNumber'
            ? (item.season ?? 0)
            : key === 'ProductionYear'
              ? (item.details?.year ?? 0)
              : item.name.toLocaleLowerCase()
  items.sort((a, b) => {
    for (const key of sorts) {
      const av = value(a, key)
      const bv = value(b, key)
      const result
        = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      if (result)
        return result * (query.sortorder === 'Descending' ? -1 : 1)
    }
    return a.id.localeCompare(b.id)
  })
  return {
    items: items.slice(query.startindex, query.startindex + query.limit),
    total: items.length,
  }
}
export async function listDto(
  projection: Projection,
  query: Query,
  candidates?: Item[],
) {
  const page = selectItems(projection, query, candidates)
  // At most one remote metadata request per title in the returned page.
  const ids = [
    ...new Set(
      page.items
        .filter(item => item.titleId && !item.details)
        .map(item => item.titleId!),
    ),
  ]
  const details = await mapLimit(
    ids,
    6,
    async id =>
      [id, (await summaryOf(id, projection.language))?.details] as const,
  )
  const byId = new Map(details)
  for (const item of page.items)
    item.details ??= item.titleId ? byId.get(item.titleId) : undefined
  return {
    Items: await Promise.all(
      page.items.map(item => itemDto(item, projection, false)),
    ),
    TotalRecordCount: page.total,
    StartIndex: query.startindex,
  }
}
