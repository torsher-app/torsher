import type {
  Card,
  ContinueCard,
  MineBootstrap,
  MineDiaryEntry,
  MineEntryMetadata,
  MinePersonalContinue,
  MineSection,
} from '@torsher/api-client'
import type { api } from '../api.ts'
import {
  captureTitleViewer,
  isTitleViewer,
  titleViewerId,
} from '../titleActions.ts'

export type MineMenuSection = Omit<MineSection, 'count'> & { count?: number }
export type DiaryQuery = Parameters<typeof api.mine.getMineDiary>[0]
export type DiaryFilter
  = 'all' | 'movies' | 'episodes' | 'rewatches' | 'undated'
export type DiaryScope = Pick<
  DiaryQuery,
  'day' | 'month' | 'year' | 'genre' | 'country'
> & { label?: string }
export type WatchedQuery = Parameters<
  typeof api.mine.getMinePersonalWatched
>[0]
export type WatchedScope = Pick<
  WatchedQuery,
  'source' | 'genre' | 'country'
> & { label: string }
export type DiaryDate = MineDiaryEntry['date']
export type ContinueState
  = MinePersonalContinue['items'][number]['continuation']

export function mineViewer() {
  const viewer = captureTitleViewer()
  const expectedProfileId = titleViewerId()
  return expectedProfileId ? { viewer, expectedProfileId } : undefined
}

export function isMineViewer(
  context: ReturnType<typeof mineViewer>,
): context is NonNullable<ReturnType<typeof mineViewer>> {
  return !!context && isTitleViewer(context.viewer)
}

export function mineStartKey(start: MineBootstrap['start']) {
  return start.kind === 'section'
    ? start.section
    : `collection:${start.collectionId}`
}

export function personalCard(
  id: string,
  kind: Card['kind'],
  metadata: MineEntryMetadata | null,
  rating?: number | null,
): Card {
  return {
    id,
    kind,
    title: metadata?.title || id,
    originalTitle: metadata?.title || id,
    year: metadata?.year ?? undefined,
    poster: metadata?.poster ?? undefined,
    ownRating: rating ?? undefined,
  }
}

export function diaryCard(entry: MineDiaryEntry) {
  return personalCard(
    entry.titleId,
    entry.kind === 'movie' ? 'movie' : 'series',
    entry.metadata,
  )
}

export function personalContinueCard(
  row: MinePersonalContinue['items'][number],
): ContinueCard {
  const activeCycle = row.cycle?.state === 'active' ? row.cycle : undefined
  const cursor = activeCycle ? activeCycle.resume : row.normalResume
  const source = cursor?.source
  return {
    ...personalCard(row.titleId, row.kind, row.metadata, row.ownRating),
    image: row.metadata?.poster ?? undefined,
    position: cursor?.position ?? 0,
    duration: cursor?.duration ?? null,
    next: cursor?.next ?? false,
    season: row.kind === 'series' ? (cursor?.season ?? null) : null,
    episode: row.kind === 'series' ? (cursor?.episode ?? null) : null,
    episodeTitle: row.metadata?.episodeTitle ?? undefined,
    mediaFileId: source?.kind === 'library' ? source.mediaFileId : undefined,
    file:
      source?.kind === 'torrent'
        ? { torrentId: source.torrentId, fileIndex: source.fileIndex }
        : null,
    cycleId: activeCycle?.id,
    cycleVoiceStudio: activeCycle?.resume?.voiceStudio,
    cycleVoiceType: activeCycle?.resume?.voiceType,
  }
}

export function diaryFilterQuery(
  filter: DiaryFilter,
  { label: _label, ...scope }: DiaryScope,
  search: string,
) {
  const filters: Record<DiaryFilter, Partial<DiaryQuery>> = {
    all: {},
    movies: { kind: 'movie' },
    episodes: { kind: 'episode' },
    rewatches: { rewatch: 'only' },
    undated: { date: 'unknown' },
  }
  return { ...filters[filter], ...scope, search: search.trim() || undefined }
}

/** Receipt identifier for one user intent. No security decisions depend on it. */
export function mineRequestId() {
  const bytes = new Uint8Array(16)
  if (
    typeof crypto !== 'undefined'
    && typeof crypto.getRandomValues === 'function'
  ) {
    crypto.getRandomValues(bytes)
  }
  else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256)
    })
  }

  bytes[6] = (bytes[6]! & 15) | 64
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = Array.from(bytes, value =>
    `0${value.toString(16)}`.slice(-2)).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
