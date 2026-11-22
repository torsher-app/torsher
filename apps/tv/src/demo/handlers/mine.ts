import type {
  Api,
  MineBootstrap,
  MineCycle,
  MineDiaryCreated,
  MineDiaryEntry,
  MineDiaryMonths,
  MineDiaryPage,
  MineEntryMetadata,
  MineItems,
  MineOverview,
  MinePersonalContinue,
  MinePersonalWatched,
  MineRecommendationExclusions,
  MineRecommendationItem,
  MineRecommendations,
  MineResponse,
  MineSection,
  MineSectionCounts,
  MineStartResponse,
  MineTitlePersonal,
  ScheduleItem,
  ScheduleResponse,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import {
  del,
  DemoError,
  get,
  NO_CONTENT,
  patch,
  post,
  put,
} from '@torsher/demo/router'
import { DAY } from '@torsher/demo/state'
import { seasonOf, TITLES } from '@torsher/demo/titles'
import { localDate, offsetDay, validMineDay } from '../../lib/mineDates.ts'
import { mineRequestId } from '../../lib/minePersonal.ts'
import { backdropFor } from '../art.ts'
import { cardFor, cardsOf, genreTag } from '../cards.ts'
import {
  MINE_DIARY_ENTRIES,
  MINE_RECOMMENDATIONS,
  MINE_UNDATED_ENTRY,
} from '../minePreviewData.ts'
import {
  airedList,
  collections,
  currentProfile,
  isFollowed,
  mineEntry,
  progressAt,
  progressOf,
  resumeOf,
  setWatched,
  statusOf,
  touchedAt,
} from '../viewer.ts'

type Section = MineSection['id']

interface Entry {
  title: DemoTitle
  /** Когда попал в раздел: по нему сортировка «по добавлению» */
  at: number
}

function byStatus(status: 'watching' | 'watched' | 'dropped'): Entry[] {
  return TITLES.filter(title => statusOf(title) === status).map(title => ({
    title,
    at:
      status === 'dropped'
        ? (mineEntry(title.id).droppedAt ?? 0)
        : touchedAt(title.id),
  }))
}

function listed(field: 'watchlistAt' | 'favoriteAt'): Entry[] {
  return TITLES.flatMap((title) => {
    const at = mineEntry(title.id)[field]

    return at ? [{ title, at }] : []
  })
}

function entriesOf(section: Section, collectionId?: string): Entry[] {
  switch (section) {
    case 'continue':
      return byStatus('watching')
    case 'watchlist':
      return listed('watchlistAt')
    case 'favorites':
      return listed('favoriteAt')
    case 'ratings':
      return TITLES.flatMap((title) => {
        const entry = mineEntry(title.id)

        return entry.rating ? [{ title, at: entry.ratedAt ?? 0 }] : []
      })
    case 'collection': {
      const ids
        = collections.find(item => item.id === collectionId)?.titles ?? []

      // Подборка хранит новые первыми: время — по месту в ней
      return ids.flatMap((id, index) => {
        const title = TITLES.find(item => item.id === id)

        return title ? [{ title, at: -index }] : []
      })
    }
    case 'watched':
      return byStatus('watched')
    case 'dropped':
      return byStatus('dropped')
  }
}

get<MineResponse>('/api/mine', () => ({
  sections: [
    { id: 'continue', count: entriesOf('continue').length },
    { id: 'watchlist', count: entriesOf('watchlist').length },
    { id: 'favorites', count: entriesOf('favorites').length },
    { id: 'ratings', count: entriesOf('ratings').length },
    ...collections.map(item => ({
      id: 'collection' as const,
      collectionId: item.id,
      name: item.name,
      count: item.titles.length,
    })),
    { id: 'watched', count: entriesOf('watched').length },
    { id: 'dropped', count: entriesOf('dropped').length },
  ],
}))

function matchesRating(rating: number | undefined, filter: string | null) {
  switch (filter) {
    case 'rated':
      return !!rating
    case 'unrated':
      return !rating
    case '9-10':
    case '7-8':
    case '5-6':
    case '1-4': {
      const [from, to] = filter.split('-').map(Number) as [number, number]

      return !!rating && rating >= from && rating <= to
    }
    default:
      return true
  }
}

get<MineItems>('/api/mine/items', ({ query }) => {
  const kind = query.get('kind')
  const offset = Number(query.get('offset')) || 0
  const limit = Number(query.get('limit')) || 40
  const rating = (title: DemoTitle) => mineEntry(title.id).rating
  const found = entriesOf(
    (query.get('section') ?? 'continue') as Section,
    query.get('collection') ?? undefined,
  )
    .filter(
      ({ title }) =>
        (kind !== 'movie' && kind !== 'series') || title.kind === kind,
    )
    .filter(({ title }) => matchesRating(rating(title), query.get('rating')))
    .sort((a, b) =>
      query.get('sort') === 'rating'
        ? (rating(b.title) ?? 0) - (rating(a.title) ?? 0) || b.at - a.at
        : b.at - a.at,
    )

  return {
    items: cardsOf(
      found.slice(offset, offset + limit).map(item => item.title),
    ),
    total: found.length,
  }
})

// Расписание: ближайшие и вышедшие за две недели серии идущих сериалов,
// которые смотрят или за которыми следят
const RECENT_MS = 14 * DAY * 1000
const UPCOMING_COUNT = 3

get<ScheduleResponse>('/api/schedule', () => {
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - RECENT_MS).toISOString().slice(0, 10)
  const upcoming: ScheduleItem[] = []
  const recent: ScheduleItem[] = []

  for (const title of TITLES) {
    const followed = isFollowed(title.id)
    const status = statusOf(title)

    if (
      !title.ongoing
      || (!followed && status !== 'watching' && status !== 'waiting')
    ) {
      continue
    }

    const number = title.seasons?.length ?? 1
    const episodes = seasonOf(title, number)?.episodes ?? []
    let ahead = 0

    for (const episode of episodes) {
      const airDate = episode.airDate ?? ''
      const item: ScheduleItem = {
        titleId: title.id,
        title: title.title,
        season: number,
        episode: episode.number,
        episodeTitle: episode.title,
        airDate,
        image: episode.still,
        followed,
        state: null,
      }

      if (airDate > today && ahead < UPCOMING_COUNT) {
        ahead += 1
        upcoming.push({ ...item, state: 'upcoming' })
      }
      else if (airDate >= since && airDate <= today) {
        recent.push(item)
      }
    }
  }

  return {
    upcoming: upcoming.sort((a, b) => a.airDate.localeCompare(b.airDate)),
    recent: recent.sort((a, b) => b.airDate.localeCompare(a.airDate)),
  }
})

const MINE = '/api/mine/v1'
type DiaryCreate = Parameters<Api<unknown>['mine']['postMineDiary']>[0]
type DiaryPatch = Parameters<Api<unknown>['mine']['patchMineDiaryEntry']>[1]
type TitlePatch = Parameters<Api<unknown>['mine']['patchMineTitlePersonal']>[1]
type CycleCreate = Parameters<Api<unknown>['mine']['postMineCycle']>[1]
type CycleChange = Parameters<Api<unknown>['mine']['patchMineCycle']>[1]
type Start = MineBootstrap['start']
type Preference = Pick<
  MineTitlePersonal,
  'note' | 'continuation' | 'notInterested'
>
type Target = Pick<MineDiaryEntry, 'titleId' | 'season' | 'episode'>
interface Receipt<T> {
  input: string
  result: T
}

interface DemoMine {
  journal: MineDiaryEntry[]
  seen: Set<string>
  preferences: Map<string, Preference>
  start: Start
  cycles: Map<string, MineCycle>
  diaryReceipts: Map<string, Receipt<MineDiaryEntry>>
  cycleReceipts: Map<string, Receipt<MineCycle>>
  recommendationRequests: Set<string>
}

const stateByProfile = new Map<string, DemoMine>()
const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const now = () => new Date().toISOString()
const today = () => localDate(new Date())
function emptyPreference(): Preference {
  return {
    note: null,
    continuation: 'normal',
    notInterested: false,
  }
}
const titleOf = (id: string) => TITLES.find(title => title.id === id)
function targetKey({ titleId, season, episode }: Target) {
  return JSON.stringify([titleId, season, episode])
}
const genreId = (name: string) => Number(genreTag(name).id)
function targetKind(target: Target) {
  return titleOf(target.titleId)?.kind === 'movie'
    ? 'movie'
    : target.episode
      ? 'episode'
      : 'series'
}

function accessible(title: DemoTitle) {
  // Demo catalog has no certification feed. Use a fixed family-safe subset in Kids.
  return (
    currentProfile().ageLimit == null
    || title.real
    || title.genres.includes('Family')
    || title.genres.includes('Animation')
  )
}

function checkProfile(expected: string | null | undefined) {
  const id = currentProfile().id
  if (expected != null && expected !== id)
    throw new DemoError(409, { kind: 'profileChanged' })
  return id
}

function requireTitle(id: string) {
  const title = titleOf(id)
  if (!title || !accessible(title))
    throw new DemoError(404, { kind: 'notFound' })
  return title
}

function metadata(
  title: DemoTitle,
  season = 0,
  episode = 0,
): MineEntryMetadata {
  const item = seasonOf(title, season)?.episodes.find(
    value => value.number === episode,
  )
  return {
    title: title.title,
    year: title.year,
    poster: cardFor(title).poster ?? null,
    episodeTitle: item?.title ?? null,
    runtimeMinutes:
      item?.runtime ?? (title.kind === 'movie' ? title.runtime : null),
    genres: title.genres,
    countries: [TITLES.indexOf(title) % 2 ? 'GB' : 'US'],
  }
}

function makeDiary(
  target: Target,
  date: MineDiaryEntry['date'],
  extra: Partial<MineDiaryEntry> = {},
): MineDiaryEntry {
  const title = titleOf(target.titleId)
  const createdAt = now()
  return {
    ...target,
    id: mineRequestId(),
    kind: targetKind(target),
    date,
    calendarDay:
      date.precision === 'unknown'
        ? null
        : date.precision === 'day'
          ? date.day
          : localDate(new Date(date.instant)),
    origin: 'manual',
    rewatch: false,
    note: null,
    viewingContext: null,
    cycleId: null,
    metadata: title ? metadata(title, target.season, target.episode) : null,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  }
}

function fixtureDiary() {
  const entries = [...MINE_DIARY_ENTRIES, MINE_UNDATED_ENTRY].map((entry) => {
    const instant
      = entry.day && entry.time
        ? new Date(`${entry.day}T${entry.time.padStart(5, '0')}:00`).getTime()
        : null
    const date: MineDiaryEntry['date'] = !entry.day
      ? { precision: 'unknown' }
      : instant === null
        ? { precision: 'day', day: entry.day }
        : {
            precision: 'instant',
            instant: new Date(Math.min(instant, Date.now())).toISOString(),
          }
    const row = makeDiary(
      {
        titleId: entry.card.id,
        season: entry.season ?? 0,
        episode: entry.episode ?? 0,
      },
      date,
      {
        origin: entry.imported
          ? entry.kind === 'movie'
            ? 'letterboxd'
            : 'trakt'
          : entry.rewatch
            ? 'manual'
            : 'playback',
        rewatch: !!entry.rewatch,
        note: entry.note
          ? 'The quiet scenes make the ending work.\n\n'.repeat(12).trim()
          : null,
        viewingContext: null,
      },
    )
    if (row.metadata) {
      row.metadata.runtimeMinutes = entry.runtime
      row.metadata.episodeTitle
        = entry.episodeTitle ?? row.metadata.episodeTitle
    }
    return row
  })
  // Enough old entries to paginate in both directions and switch browser years.
  for (let index = 0; index < 96; index++) {
    const title = TITLES[index % 7]!
    const timestamp = offsetDay(today(), -65 - index * 11)
    entries.push(
      makeDiary(
        { titleId: title.id, season: 0, episode: 0 },
        { precision: 'day', day: timestamp },
        { origin: title.kind === 'movie' ? 'letterboxd' : 'trakt' },
      ),
    )
  }
  return entries
}

function demoMine(expected?: string | null) {
  const id = checkProfile(expected)
  let state = stateByProfile.get(id)
  if (!state) {
    const journal = id === 'profile-alex' ? fixtureDiary() : []
    state = {
      journal,
      seen: new Set(journal.map(targetKey)),
      preferences: new Map(),
      start: { kind: 'section', section: 'continue' },
      cycles: new Map(),
      diaryReceipts: new Map(),
      cycleReceipts: new Map(),
      recommendationRequests: new Set(),
    }
    if (id === 'profile-alex') {
      const hidden = TITLES.find(
        title => title.title === 'Signal from Halden Reach',
      )
      const paused = TITLES.find(
        title => title.title === 'Starling Protocol',
      )
      if (hidden) {
        state.preferences.set(hidden.id, {
          ...emptyPreference(),
          continuation: 'hidden',
        })
      }
      if (paused) {
        state.preferences.set(paused.id, {
          ...emptyPreference(),
          continuation: 'paused',
        })
      }
    }
    if (id === 'profile-sam') {
      const marked = TITLES.find(
        title => title.kind === 'movie' && title.title === 'Winter in Tolvar',
      )!
      setWatched(marked.id, 0, 0, true)
      Object.assign(mineEntry(marked.id), {
        rating: 9,
        ratedAt: Date.now(),
        favoriteAt: Date.now(),
      })
    }
    stateByProfile.set(id, state)
  }
  return state
}

function profileQuery(query: URLSearchParams) {
  return demoMine(query.get('expectedProfileId'))
}

function preference(state: DemoMine, id: string) {
  return state.preferences.get(id) ?? emptyPreference()
}

function wireCycle(cycle: MineCycle) {
  return cycle.state === 'active' ? { ...cycle } : { ...cycle, resume: null }
}

function activeCycle(state: DemoMine, id: string) {
  return (
    [...state.cycles.values()].find(
      row => row.titleId === id && row.state !== 'ended',
    ) ?? null
  )
}

function cycleOf(state: DemoMine, id: string) {
  const cycle = activeCycle(state, id)
  return cycle && wireCycle(cycle)
}

function visibleDiary(state: DemoMine) {
  const rows = state.journal
    .filter((entry) => {
      const title = titleOf(entry.titleId)
      return !title || accessible(title)
    })
    .sort(
      (left, right) =>
        (right.calendarDay ?? '').localeCompare(left.calendarDay ?? '')
        || (right.date.precision === 'instant'
          ? right.date.instant
          : ''
        ).localeCompare(
          left.date.precision === 'instant' ? left.date.instant : '',
        )
        || right.createdAt.localeCompare(left.createdAt)
        || right.id.localeCompare(left.id),
    )
  return rows
}

function diaryRows(state: DemoMine, query: URLSearchParams) {
  const kind = query.get('kind')
  const date = query.get('date')
  const day = query.get('day')
  const month = query.get('month')
  const year = query.get('year')
  const search = query.get('search')?.toLowerCase()
  return visibleDiary(state).filter(
    row =>
      (!kind || kind === 'all' || row.kind === kind)
      && (date !== 'dated' || !!row.calendarDay)
      && (date !== 'unknown' || !row.calendarDay)
      && (query.get('rewatch') !== 'only' || row.rewatch)
      && (!day || row.calendarDay === day)
      && (!month || row.calendarDay?.startsWith(month))
      && (!year || row.calendarDay?.startsWith(year))
      && (!query.get('genre')
        || row.metadata?.genres?.some(
          name => genreId(name) === Number(query.get('genre')),
        ))
        && (!query.get('country')
          || row.metadata?.countries?.includes(query.get('country')!))
        && (!search
          || [row.metadata?.title, row.note, row.viewingContext].some(value =>
            value?.toLowerCase().includes(search),
          )),
  )
}

function diaryMonths(rows: MineDiaryEntry[]) {
  const months = new Map<string | null, number>()
  for (const row of rows) {
    const month = row.calendarDay?.slice(0, 7) ?? null
    months.set(month, (months.get(month) ?? 0) + 1)
  }
  return [...months.entries()].map(([month, count]) => ({ month, count }))
}

function limitOf(query: URLSearchParams) {
  return Math.min(40, Math.max(1, Number(query.get('limit')) || 40))
}

function pageOf<T>(items: T[], query: URLSearchParams) {
  const offset = Math.max(0, Number(query.get('offset')) || 0)
  return {
    items: items.slice(offset, offset + limitOf(query)),
    total: items.length,
  }
}

function checkDate(date: MineDiaryEntry['date']) {
  if (
    (date.precision === 'day' && !validMineDay(date.day, today()))
    || (date.precision === 'instant'
      && (!Number.isFinite(Date.parse(date.instant))
        || Date.parse(date.instant) > Date.now()))
  ) {
    throw new DemoError(400, { kind: 'invalidDate' })
  }
}

function checkTarget(point: Target) {
  const title = requireTitle(point.titleId)
  if (
    (point.season > 0 && !point.episode)
    || (point.episode
      && !airedList(title).some(
        row => row.season === point.season && row.episode === point.episode,
      ))
  ) {
    throw new DemoError(400, { kind: 'invalidEpisode' })
  }
  return title
}

function existingReceipt<T>(
  receipts: Map<string, Receipt<T>>,
  requestId: string,
  input: string,
) {
  const previous = receipts.get(requestId)
  if (previous && previous.input !== input)
    throw new DemoError(409, { kind: 'conflict' })
  return previous?.result
}

function sectionCounts(state: DemoMine): MineSectionCounts {
  return {
    profileId: currentProfile().id,
    collections: collections.map(item => ({
      id: item.id,
      count: item.titles.filter((id) => {
        const title = titleOf(id)
        return !!title && accessible(title)
      }).length,
    })),
    counts: {
      continue: continueItems(state, new URLSearchParams()).length,
      watched: watchedTitles(state, new URLSearchParams()).length,
      watchlist: entriesOf('watchlist').filter(row => accessible(row.title)).length,
      favorites: entriesOf('favorites').filter(row => accessible(row.title)).length,
      ratings: entriesOf('ratings').filter(row => accessible(row.title)).length,
      dropped: entriesOf('dropped').filter(row => accessible(row.title)).length,
    },
  }
}

get<MineSectionCounts>(`${MINE}/section-counts`, ({ query }) =>
  sectionCounts(profileQuery(query)))

get<MineBootstrap>(`${MINE}/bootstrap`, ({ query }) => {
  const state = profileQuery(query)
  const profile = currentProfile()
  const data = sectionCounts(state)
  const counts = new Map(data.collections.map(({ id, count }) => [id, count]))
  return {
    version: 1,
    profileId: profile.id,
    language: profile.language,
    today: today(),
    timeZone,
    start: state.start,
    collections: collections.map(({ id, name }) => ({
      id,
      name,
      count: counts.get(id) ?? null,
    })),
    counts: { ...data.counts, schedule: null },
  }
})

put<MineStartResponse, { expectedProfileId: string, start: Start }>(
  `${MINE}/start-section`,
  ({ body }) => {
    const state = demoMine(body.expectedProfileId)
    state.start = body.start
    return { start: state.start }
  },
)

get<MineDiaryPage>(`${MINE}/diary`, ({ query }) => {
  const rows = diaryRows(profileQuery(query), query)
  const anchor = query.get('anchorMonth')
  const cursor = query.get('cursor')
  const limit = limitOf(query)
  const start = cursor
    ? Math.max(0, Number(cursor))
    : anchor
      ? Math.max(
          0,
          rows.findIndex(row => row.calendarDay?.slice(0, 7) === anchor),
        )
      : 0
  const newer = query.get('direction') === 'newer'
  const first = newer ? Math.max(0, start - limit) : start
  const end = newer ? start : Math.min(rows.length, start + limit)
  return {
    profileId: currentProfile().id,
    entries: rows.slice(first, end),
    total: rows.length,
    distinctTitles: new Set(rows.map(row => row.titleId)).size,
    olderCursor: end < rows.length ? String(end) : null,
    newerCursor: first > 0 ? String(first) : null,
    months: diaryMonths(rows),
  }
})

get<MineDiaryMonths>(`${MINE}/diary/months`, ({ query }) => ({
  months: diaryMonths(diaryRows(profileQuery(query), query)),
}))

post<MineDiaryCreated, DiaryCreate>(`${MINE}/diary`, ({ body }) => {
  const state = demoMine(body.expectedProfileId)
  const input = JSON.stringify([
    body.target,
    body.date,
    body.note,
    body.viewingContext,
    body.rewatch,
  ])
  const previous = existingReceipt(state.diaryReceipts, body.requestId, input)
  if (previous) {
    return {
      entry: visibleDiary(state).find(row => row.id === previous.id) ?? null,
    }
  }
  checkTarget(body.target)
  checkDate(body.date)
  const row = makeDiary(body.target, body.date, {
    note: body.note ?? null,
    viewingContext: body.viewingContext ?? null,
    rewatch: !!body.rewatch,
  })
  state.journal.push(row)
  state.seen.add(targetKey(row))
  state.diaryReceipts.set(body.requestId, { input, result: row })
  return { entry: visibleDiary(state).find(entry => entry.id === row.id)! }
})

patch<MineDiaryEntry, DiaryPatch>(`${MINE}/diary/:id`, ({ params, body }) => {
  const state = demoMine(body.expectedProfileId)
  const row = state.journal.find(entry => entry.id === params.id)
  if (!row)
    throw new DemoError(404, { kind: 'notFound' })
  if (body.date) {
    checkDate(body.date)
    row.date = body.date
    row.calendarDay = makeDiary(row, body.date).calendarDay
  }
  if (body.rewatch !== undefined && row.origin === 'manual')
    row.rewatch = body.rewatch
  if (body.note !== undefined)
    row.note = body.note
  if (body.viewingContext !== undefined)
    row.viewingContext = body.viewingContext
  row.updatedAt = now()
  return visibleDiary(state).find(entry => entry.id === row.id)!
})

del(`${MINE}/diary/:id`, ({ params, query }) => {
  const state = profileQuery(query)
  state.journal = state.journal.filter(row => row.id !== params.id)
  return NO_CONTENT
})

function marks(state: DemoMine) {
  const logged = new Set(visibleDiary(state).map(row => row.titleId))
  return TITLES.filter(
    title =>
      accessible(title)
      && !logged.has(title.id)
      && (title.kind === 'movie'
        ? !!progressAt(title.id)?.watched
        : statusOf(title) === 'watched'),
  )
}

function watchedTitles(state: DemoMine, query: URLSearchParams) {
  const source = query.get('source')
  const matches
    = source === 'earlierMarks'
      ? marks(state)
      : TITLES.filter((title) => {
          if (!accessible(title))
            return false
          const mine = mineEntry(title.id)
          if (source === 'ratingsAndFavorites')
            return !!mine.rating || !!mine.favoriteAt
          return (
            statusOf(title) === 'watched'
            || state.seen.has(
              targetKey({ titleId: title.id, season: 0, episode: 0 }),
            )
          )
        })
  return matches.filter((title) => {
    const data = metadata(title)
    return (
      (!query.get('kind')
        || query.get('kind') === 'all'
        || title.kind === query.get('kind'))
      && matchesRating(mineEntry(title.id).rating, query.get('rating'))
      && (!query.get('genre')
        || data.genres.some(
          name => genreId(name) === Number(query.get('genre')),
        ))
        && (!query.get('country') || data.countries.includes(query.get('country')!))
    )
  })
}

get<MinePersonalWatched>(`${MINE}/watched`, ({ query }) => {
  const titles = watchedTitles(profileQuery(query), query).sort(
    (a, b) =>
      (query.get('sort') === 'rating'
        ? (mineEntry(b.id).rating ?? 0) - (mineEntry(a.id).rating ?? 0)
        : 0) || touchedAt(b.id) - touchedAt(a.id),
  )
  return {
    profileId: currentProfile().id,
    ...pageOf(
      titles.map(title => ({
        titleId: title.id,
        kind: title.kind,
        metadata: metadata(title),
        ownRating: mineEntry(title.id).rating ?? null,
      })),
      query,
    ),
  }
})

get<MineOverview>(`${MINE}/overview`, ({ query }) => {
  const state = profileQuery(query)
  const period = query.get('period') ?? today().slice(0, 7)
  const history = visibleDiary(state)
  const firstDay = !history.some(entry => entry.calendarDay)
  const recent = history.filter(entry =>
    entry.calendarDay?.startsWith(period),
  )
  const movies = recent.filter(row => row.kind === 'movie')
  const episodes = recent.filter(row => row.kind === 'episode')
  const runtime = recent.flatMap(row => row.metadata?.runtimeMinutes ?? [])
  const dayCounts = new Map<string, number>()
  for (const row of recent) {
    if (row.calendarDay)
      dayCounts.set(row.calendarDay, (dayCounts.get(row.calendarDay) ?? 0) + 1)
  }
  const liked = firstDay
    ? watchedTitles(
        state,
        new URLSearchParams('source=ratingsAndFavorites'),
      ).map(title => title.id)
    : recent.map(row => row.titleId)
  const unique = [...new Set(liked)]
  const facets = unique.flatMap((id) => {
    const title = titleOf(id)
    return title ? [metadata(title)] : []
  })
  const count = (field: 'genres' | 'countries') =>
    [...new Set(facets.flatMap(row => row[field]))]
      .map(label => ({
        label,
        count: facets.filter(row => row[field].includes(label)).length,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const earlier = marks(state)
  return {
    profileId: currentProfile().id,
    timeZone,
    today: today(),
    period,
    totals: {
      movies: movies.length,
      episodes: episodes.length,
      series: recent.length - movies.length - episodes.length,
      rewatch: recent.filter(row => row.rewatch).length,
      days: dayCounts.size,
      distinctMovies: new Set(movies.map(row => row.titleId)).size,
      distinctEpisodes: new Set(episodes.map(targetKey)).size,
      runtimeMinutes: runtime.reduce((sum, minutes) => sum + minutes, 0),
      runtimeKnown: runtime.length,
      runtimeUnknown: recent.length - runtime.length,
    },
    days: [...dayCounts.entries()].map(([day, count]) => ({ day, count })),
    recent: recent.slice(0, 5),
    interests: {
      source: firstDay ? 'ratingsAndFavorites' : 'diary',
      genres: count('genres').flatMap(row =>
        genreId(row.label) ? [{ ...row, value: genreId(row.label) }] : [],
      ),
      countries: count('countries').map(row => ({
        value: row.label,
        count: row.count,
      })),
      titlesWithMetadata: facets.length,
      titles: unique.length,
    },
    previousMarks: {
      movies: earlier.filter(title => title.kind === 'movie').length,
      series: earlier.filter(title => title.kind === 'series').length,
      examples: earlier
        .slice(0, 5)
        .map(title => ({ titleId: title.id, metadata: metadata(title) })),
    },
  }
})

function personalTitle(
  state: DemoMine,
  title: DemoTitle,
  season = 0,
  episode = 0,
): MineTitlePersonal {
  const root = { titleId: title.id, season: 0, episode: 0 }
  const titleSeen
    = state.seen.has(targetKey(root))
      || (title.kind === 'movie'
        ? !!progressAt(title.id)?.watched
        : statusOf(title) === 'watched')
  return {
    titleId: title.id,
    ...preference(state, title.id),
    status: titleSeen ? 'watched' : statusOf(title),
    seen: {
      title: titleSeen,
      episode: episode
        ? state.seen.has(targetKey({ titleId: title.id, season, episode }))
        || !!progressAt(title.id, season, episode)?.watched
        : null,
    },
    cycle: cycleOf(state, title.id),
  }
}

get<MineTitlePersonal>(`${MINE}/title/:id`, ({ params, query }) =>
  personalTitle(
    profileQuery(query),
    requireTitle(params.id!),
    Number(query.get('season')) || 0,
    Number(query.get('episode')) || 0,
  ))

patch<MineTitlePersonal, TitlePatch>(
  `${MINE}/title/:id`,
  ({ params, body }) => {
    const state = demoMine(body.expectedProfileId)
    const title = requireTitle(params.id!)
    const current = preference(state, title.id)
    if (body.note !== undefined)
      current.note = body.note
    if (body.continuation !== undefined)
      current.continuation = body.continuation
    if (body.notInterested !== undefined)
      current.notInterested = body.notInterested
    state.preferences.set(title.id, current)
    return personalTitle(state, title)
  },
)

put<MineTitlePersonal, Parameters<Api<unknown>['mine']['putMineSeen']>[1]>(
  `${MINE}/title/:id/seen`,
  ({ params, body }) => {
    const state = demoMine(body.expectedProfileId)
    const point = {
      titleId: params.id!,
      season: body.season,
      episode: body.episode,
    }
    const title = checkTarget(point)
    if (body.watched)
      state.seen.add(targetKey(point))
    else state.seen.delete(targetKey(point))
    if (title.kind === 'series' && !body.episode) {
      for (const row of airedList(title)) {
        if (!body.watched)
          state.seen.delete(targetKey({ titleId: title.id, ...row }))
        setWatched(title.id, row.season, row.episode, body.watched)
      }
    }
    else {
      setWatched(title.id, body.season, body.episode, body.watched)
    }
    return personalTitle(state, title, body.season, body.episode)
  },
)

post<MineCycle, CycleCreate>(`${MINE}/title/:id/cycles`, ({ params, body }) => {
  const state = demoMine(body.expectedProfileId)
  const point = { season: body.season, episode: body.episode }
  const title = checkTarget({ ...point, titleId: params.id! })
  const input = JSON.stringify([title.id, point])
  const previous = existingReceipt(state.cycleReceipts, body.requestId, input)
  if (previous)
    return previous
  if (title.kind !== 'series' || !point.episode || activeCycle(state, title.id))
    throw new DemoError(409, { kind: 'conflict' })
  const cycle: MineCycle = {
    id: mineRequestId(),
    titleId: title.id,
    start: point,
    target: point,
    state: 'active',
    updatedAt: now(),
    resume: {
      ...point,
      position: 0,
      duration: null,
      source: null,
      voiceStudio: null,
      voiceType: null,
      next: false,
    },
  }
  state.cycles.set(cycle.id, cycle)
  state.cycleReceipts.set(body.requestId, { input, result: cycle })
  return wireCycle(cycle)
})

patch<MineCycle, CycleChange>(`${MINE}/cycles/:id`, ({ params, body }) => {
  const state = demoMine(body.expectedProfileId)
  const cycle = state.cycles.get(params.id!)
  if (!cycle)
    throw new DemoError(404, { kind: 'notFound' })
  if (cycle.state === 'ended' && body.action !== 'end')
    throw new DemoError(409, { kind: 'conflict' })
  cycle.state
    = body.action === 'pause'
      ? 'paused'
      : body.action === 'resume'
        ? 'active'
        : 'ended'
  cycle.updatedAt = now()
  return wireCycle(cycle)
})

function continueItems(
  state: DemoMine,
  query: URLSearchParams,
): MinePersonalContinue['items'] {
  return TITLES.flatMap((title) => {
    const current = preference(state, title.id).continuation
    const cycle = cycleOf(state, title.id)
    const ordinary = resumeOf(title)
    const rating = mineEntry(title.id).rating
    const wanted = query.get('state') ?? 'normal'
    if (
      !accessible(title)
      || current !== wanted
      || (query.has('kind')
        && query.get('kind') !== 'all'
        && query.get('kind') !== title.kind)
      || !matchesRating(rating, query.get('rating'))
      || (current === 'normal'
        && cycle?.state !== 'active'
        && (!ordinary || statusOf(title) === 'dropped'))
    ) {
      return []
    }
    const normalResume: MinePersonalContinue['items'][number]['normalResume']
      = ordinary && cycle?.state !== 'active'
        ? {
            season: ordinary.season ?? 0,
            episode: ordinary.episode ?? 0,
            position: ordinary.position,
            duration: ordinary.duration,
            next: ordinary.next,
            source: ordinary.file
              ? { kind: 'torrent', ...ordinary.file }
              : null,
            voiceStudio: null,
            voiceType: null,
          }
        : null

    return [
      {
        titleId: title.id,
        kind: title.kind,
        metadata: metadata(
          title,
          cycle?.target.season ?? ordinary?.season ?? 0,
          cycle?.target.episode ?? ordinary?.episode ?? 0,
        ),
        continuation: current,
        cycle,
        normalResume,
        ownRating: rating ?? null,
        updatedAt:
          cycle?.state === 'active'
            ? cycle.updatedAt
            : new Date(touchedAt(title.id)).toISOString(),
      },
    ]
  }).sort(
    (a, b) =>
      (query.get('sort') === 'rating'
        ? (b.ownRating ?? 0) - (a.ownRating ?? 0)
        : 0) || b.updatedAt.localeCompare(a.updatedAt),
  )
}

get<MinePersonalContinue>(`${MINE}/continue`, ({ query }) => ({
  profileId: currentProfile().id,
  ...pageOf(continueItems(profileQuery(query), query), query),
}))

export function personalHomeContinue(query: URLSearchParams) {
  if (query.get('personalContinue') !== '1')
    return undefined
  const state = profileQuery(query)
  return {
    visible: (id: string) => {
      const title = titleOf(id)
      return (
        !!title
        && accessible(title)
        && preference(state, id).continuation === 'normal'
      )
    },
    cycles: continueItems(state, new URLSearchParams()).filter(
      row => row.cycle?.state === 'active' && !!row.cycle.resume,
    ),
    activeCycleIds: new Set(
      [...state.cycles.values()]
        .filter(row => row.state === 'active')
        .map(row => row.titleId),
    ),
  }
}

export function demoCycle(profileId: string, cycleId: string) {
  return demoMine(profileId).cycles.get(cycleId)
}

export function demoSeenEpisodes(titleId: string) {
  const state = demoMine(currentProfile().id)
  const keys = new Set(state.seen)
  for (const row of progressOf(titleId)) {
    if (row.watched) {
      keys.add(
        targetKey({ titleId, season: row.season, episode: row.episode }),
      )
    }
  }
  const result = []
  for (const key of keys) {
    const [id, season, episode] = JSON.parse(key) as [string, number, number]
    if (id === titleId && episode > 0)
      result.push({ season, episode })
  }
  return result.sort((a, b) => a.season - b.season || a.episode - b.episode)
}

export function demoPlaybackSample(
  profileId: string,
  target: Target,
  source: NonNullable<MineCycle['resume']>['source'],
  position: number,
  duration: number | null,
  forward: boolean,
  completed: boolean,
  cycleId?: string,
) {
  const state = demoMine(profileId)
  if (forward && state.preferences.has(target.titleId))
    preference(state, target.titleId).continuation = 'normal'

  if (completed) {
    const rewatch
      = !!cycleId
        || state.seen.has(targetKey(target))
        || state.journal.some(row => targetKey(row) === targetKey(target))
    state.journal.push(
      makeDiary(
        target,
        { precision: 'instant', instant: now() },
        { origin: 'playback', cycleId: cycleId ?? null, rewatch },
      ),
    )
    state.seen.add(targetKey(target))
  }
  const cycle = cycleId ? state.cycles.get(cycleId) : undefined
  if (!cycle || cycle.state !== 'active' || (!forward && !completed))
    return
  if (completed) {
    const aired = airedList(requireTitle(target.titleId))
    const after
      = aired[
        aired.findIndex(
          row =>
            row.season === target.season && row.episode === target.episode,
        ) + 1
      ]
    if (after) {
      cycle.target = after
      cycle.resume = {
        ...after,
        position: 0,
        duration: null,
        source: null,
        voiceStudio: null,
        voiceType: null,
        next: true,
      }
    }
    else {
      cycle.resume = null
    }
  }
  else {
    cycle.target = { season: target.season, episode: target.episode }
    cycle.resume = {
      season: target.season,
      episode: target.episode,
      source,
      position,
      duration,
      voiceStudio: null,
      voiceType: null,
      next: false,
    }
  }
  cycle.updatedAt = now()
}

const genres = [...new Set(TITLES.flatMap(title => title.genres))]
  .map(name => ({ id: genreId(name), name }))
  .filter(row => row.id > 0)
  .sort((a, b) => a.name.localeCompare(b.name))

get<MineRecommendations>(`${MINE}/recommendations`, ({ query }) => {
  const state = profileQuery(query)
  const source = query.get('source') ?? 'both'
  const kind = query.get('kind') ?? 'all'
  const maxMinutes = Number(query.get('maxMinutes')) || undefined
  const genre = Number(query.get('genre')) || undefined
  const selected = genres.find(row => row.id === genre)
  const excluded = new Set(
    watchedTitles(state, new URLSearchParams()).map(title => title.id),
  )
  const signal = TITLES.find(
    title => accessible(title) && (mineEntry(title.id).rating ?? 0) >= 6,
  )
  const favorite = TITLES.find(
    title => accessible(title) && !!mineEntry(title.id).favoriteAt,
  )
  const watched = visibleDiary(state).find(row => row.calendarDay)
  const hasPersonalSignals = !!signal || !!favorite || !!watched
  const items: MineRecommendationItem[] = []
  const candidates = [
    ...MINE_RECOMMENDATIONS.map(item => item.title),
    ...TITLES,
  ]
  for (const title of new Set(candidates)) {
    const mine = mineEntry(title.id)
    const inWatchlist = !!mine.watchlistAt
    const itemGenres = title.genres.flatMap(
      name => genres.find(row => row.name === name) ?? [],
    )
    const fixture = MINE_RECOMMENDATIONS.find(
      item => item.title.id === title.id,
    )
    const runtimeMinutes
      = fixture?.runtimeKnown === false ? null : title.runtime
    const episode = title.kind === 'series' ? airedList(title)[0] : undefined
    if (
      !accessible(title)
      || excluded.has(title.id)
      || preference(state, title.id).notInterested
      || (kind !== 'all' && title.kind !== kind)
      || (source === 'watchlist' && !inWatchlist)
      || (source === 'new' && inWatchlist)
      || (genre && !itemGenres.some(row => row.id === genre))
      || (maxMinutes && (!runtimeMinutes || runtimeMinutes > maxMinutes))
    ) {
      continue
    }
    const reason: MineRecommendationItem['reason']
      = inWatchlist && mine.watchlistAt
        ? { kind: 'watchlistSince', day: localDate(new Date(mine.watchlistAt)) }
        : selected
          ? { kind: 'selectedGenre', genre: selected }
          : signal
            ? {
                kind: 'ratedSeed',
                titleId: signal.id,
                title: signal.title,
                rating: mineEntry(signal.id).rating!,
              }
            : favorite
              ? {
                  kind: 'favoriteSeed',
                  titleId: favorite.id,
                  title: favorite.title,
                }
              : watched
                ? {
                    kind: 'watchedSeed',
                    titleId: watched.titleId,
                    title: watched.metadata?.title ?? watched.titleId,
                  }
                : null
    items.push({
      card: cardFor(title),
      backdrop: backdropFor(title) ?? null,
      genres: itemGenres,
      runtimeMinutes,
      episode: episode ?? null,
      reason,
    })
    if (items.length === 12)
      break
  }

  const key = JSON.stringify([source, kind, maxMinutes, genre])
  const pending
    = currentProfile().id === 'profile-alex'
      && query.get('refresh') !== 'poll'
      && source !== 'watchlist'
      && !state.recommendationRequests.has(key)
  if (pending)
    state.recommendationRequests.add(key)
  return {
    profileId: currentProfile().id,
    items: pending ? items.slice(0, 4) : items,
    genres,
    hasPersonalSignals,
    refresh: pending
      ? { state: 'pending' }
      : currentProfile().id === 'profile-kids'
        && source === 'new'
        && !items.length
        ? { state: 'unavailable', cause: 'network', retryAfterMs: 15000 }
        : { state: 'idle' },
  }
})

get<MineRecommendationExclusions>(
  `${MINE}/recommendation-exclusions`,
  ({ query }) => {
    const state = profileQuery(query)
    return {
      profileId: currentProfile().id,
      ...pageOf(
        TITLES.filter(
          title =>
            accessible(title) && preference(state, title.id).notInterested,
        ).map(cardFor),
        query,
      ),
    }
  },
)
