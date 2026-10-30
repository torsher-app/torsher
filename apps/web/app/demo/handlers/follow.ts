import type {
  AttentionItem,
  BlocklistItem,
  BlocklistResponse,
  BlockReleaseInput,
  FollowActivityItem,
  FollowActivityResponse,
  FollowCandidate,
  FollowCandidatesResponse,
  FollowDetails,
  FollowEpisode,
  FollowListResponse,
  FollowQueueItem,
  FollowQueueResponse,
  FollowSettings,
  FollowSummary,
  MessageResponse,
  UpdateFollowInput,
  UpdateFollowSettingsInput,
} from '@torsher/api-client'
import {
  airedEpisodes,
  fakeInfohash,
  findTitle,
  posterOf,
  releaseName,
  titleNamed,
} from '@torsher/demo/titles'
import { del, DemoError, get, patch, post, put } from '@torsher/demo/router'
import {
  ago,
  DAY,
  elapsedSeconds,
  GB,
  HOUR,
  isFresh,
  MB,
  MINUTE,
  nextId,
} from '@torsher/demo/state'

type EpisodeState = FollowEpisode['state']
type ActivityKind = FollowActivityItem['kind']

/** Слежение без того, что выводится из серий и истории */
type DemoFollow = Omit<
  FollowDetails,
  | 'title'
  | 'poster'
  | 'year'
  | 'next'
  | 'wanted'
  | 'counts'
  | 'first'
  | 'unsure'
  | 'waitUntil'
  | 'audioEffective'
  | 'audioServer'
>

const WANTED: ReadonlySet<EpisodeState> = new Set([
  'searching',
  'waiting',
  'no_space',
  'missing',
])

const COUNT_KEYS: Record<EpisodeState, keyof FollowSummary['counts']> = {
  upcoming: 'upcoming',
  searching: 'searching',
  waiting: 'waiting',
  downloading: 'downloading',
  no_space: 'noSpace',
  missing: 'missing',
  in_library: 'inLibrary',
  ready: 'ready',
}

const FIRST_KEYS: Partial<Record<EpisodeState, keyof FollowSummary['first']>>
  = {
    searching: 'searching',
    missing: 'missing',
    downloading: 'downloading',
    no_space: 'noSpace',
  }

const PROFILES = {
  alex: { id: 'profile-alex', name: 'Alex', color: 'violet' },
  sam: { id: 'profile-sam', name: 'Sam', color: 'green' },
  kids: { id: 'profile-kids', name: 'Kids', color: 'amber' },
} satisfies Record<string, FollowDetails['profiles'][number]>

// Выдуманные студии озвучки: настоящих в данных демо нет
const STUDIO_A = 'Demo Voices'
const STUDIO_B = 'Studio North'

// Ручной поиск «идёт» несколько секунд, потом пишет событие в историю
const SEARCH_MS = 4000

/** Дата `YYYY-MM-DD` через `days` дней от сегодня, по местному времени */
function airDate(days: number) {
  const date = new Date(Date.now() + days * DAY * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function inFuture(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

const key = (season: number, episode: number) => `${season}:${episode}`

/**
 * Серии с курсора: вышедшие — раз в неделю до позавчера, будущие — раз
 * в неделю с ближайших дней. У идущего сериала последний сезон вышел
 * наполовину, как в карточке каталога.
 */
function episodesOf(
  titleName: string,
  start: { season: number, episode: number },
  aired: EpisodeState,
  overrides: Record<string, Partial<FollowEpisode>> = {},
): FollowEpisode[] {
  const title = titleNamed(titleName)
  const all: { season: number, episode: number, isAired: boolean }[] = []

  title.seasons!.forEach((count, index) => {
    const season = index + 1
    const airedCount = airedEpisodes(title, season)

    for (let episode = 1; episode <= count; episode++) {
      if (
        season > start.season
        || (season === start.season && episode >= start.episode)
      ) {
        all.push({ season, episode, isAired: episode <= airedCount })
      }
    }
  })

  const airedList = all.filter(item => item.isAired)
  const upcoming = all.filter(item => !item.isAired)

  return all.map((item) => {
    const days = item.isAired
      ? -(2 + 7 * (airedList.length - 1 - airedList.indexOf(item)))
      : 5 + 7 * upcoming.indexOf(item)
    const state: EpisodeState = item.isAired ? aired : 'upcoming'

    return {
      season: item.season,
      episode: item.episode,
      airDate: airDate(days),
      state,
      candidates: item.isAired ? 4 : 0,
      ...overrides[key(item.season, item.episode)],
    }
  })
}

function followOf(
  fields: Partial<DemoFollow> & Pick<DemoFollow, 'id' | 'titleId' | 'episodes'>,
): DemoFollow {
  return {
    kind: 'series',
    state: 'active',
    start: { season: 1, episode: 1 },
    voiceStudio: null,
    voiceStrict: false,
    requireRussian: false,
    waitHours: 24,
    qualityPreset: 'best',
    mode: 'download',
    audio: null,
    profiles: [PROFILES.alex],
    createdAt: ago(90 * DAY),
    updatedAt: ago(20 * DAY),
    lastSearchAt: ago(3 * HOUR),
    nextSearchAt: inFuture(3 * HOUR),
    searchRequested: false,
    ...fields,
  }
}

const kites = titleNamed('Kites over Mareth')
const harbor = titleNamed('Ninefold Harbor')
const brightwater = titleNamed('Brightwater Ninety')
const saltwater = titleNamed('Saltwater Lullaby')

let follows: DemoFollow[] = isFresh
  ? []
  : [
      followOf({
        id: 'follow-kites',
        titleId: kites.id,
        voiceStudio: STUDIO_A,
        profiles: [PROFILES.alex, PROFILES.kids],
        createdAt: ago(40 * DAY),
        start: { season: 2, episode: 1 },
        episodes: episodesOf(
          'Kites over Mareth',
          { season: 2, episode: 1 },
          'in_library',
          {
            [key(2, 4)]: { state: 'downloading' },
            [key(2, 5)]: { state: 'waiting', waitUntil: inFuture(9 * HOUR) },
          },
        ),
      }),
      followOf({
        id: 'follow-harbor',
        titleId: harbor.id,
        start: { season: 3, episode: 1 },
        voiceStudio: STUDIO_B,
        voiceStrict: true,
        qualityPreset: 'uhd',
        waitHours: 48,
        profiles: [PROFILES.alex, PROFILES.sam],
        createdAt: ago(60 * DAY),
        episodes: episodesOf(
          'Ninefold Harbor',
          { season: 3, episode: 1 },
          'in_library',
          {
            [key(3, 4)]: { state: 'downloading' },
            [key(3, 5)]: { state: 'searching', candidates: 1 },
          },
        ),
      }),
      followOf({
        id: 'follow-brightwater',
        titleId: brightwater.id,
        state: 'paused',
        mode: 'notify',
        qualityPreset: 'compact',
        waitHours: 0,
        profiles: [PROFILES.sam],
        createdAt: ago(30 * DAY),
        updatedAt: ago(4 * DAY),
        lastSearchAt: ago(4 * DAY),
        nextSearchAt: null,
        episodes: episodesOf(
          'Brightwater Ninety',
          { season: 1, episode: 1 },
          'ready',
          {
            [key(1, 4)]: { state: 'searching', candidates: 0 },
          },
        ),
      }),
      followOf({
        id: 'follow-saltwater',
        titleId: saltwater.id,
        state: 'done',
        profiles: [PROFILES.alex],
        createdAt: ago(150 * DAY),
        updatedAt: ago(70 * DAY),
        lastSearchAt: ago(70 * DAY),
        nextSearchAt: null,
        episodes: episodesOf(
          'Saltwater Lullaby',
          { season: 1, episode: 1 },
          'in_library',
        ),
      }),
    ]

let activity: FollowActivityItem[] = []
let blocklist: BlocklistItem[] = []
// Когда закончится запрошенный вручную поиск слежения
const searchDone = new Map<string, number>()

function event(
  follow: DemoFollow | undefined,
  kind: ActivityKind,
  secondsAgo: number,
  fields: Partial<FollowActivityItem> = {},
): FollowActivityItem {
  return {
    id: nextId('act'),
    at: ago(secondsAgo),
    kind,
    followId: follow?.id ?? null,
    titleId: follow?.titleId ?? null,
    season: null,
    episodes: [],
    releaseTitle: null,
    indexer: null,
    torrentId: null,
    params: {},
    ...fields,
  }
}

/** Раздача серии: `quality` в имени и параметрах события совпадают */
function release(
  follow: DemoFollow,
  season: number,
  episode: number,
  quality = '1080p',
) {
  const tail
    = quality === '2160p' ? '2160p.WEB-DL.HEVC' : `${quality}.WEB-DL.H.264`

  return releaseName(findTitle(follow.titleId)!, {
    season,
    episode,
    quality: tail,
  })
}

function seedActivity() {
  const [fKites, fHarbor, fBright, fSalt] = follows as [
    DemoFollow,
    DemoFollow,
    DemoFollow,
    DemoFollow,
  ]
  const ep = (
    follow: DemoFollow,
    season: number,
    episode: number,
    quality?: string,
  ) => ({
    season,
    episodes: [episode],
    releaseTitle: release(follow, season, episode, quality),
  })

  const items = [
    event(fKites, 'grabbed', 25 * MINUTE, {
      ...ep(fKites, 2, 4),
      indexer: 'Demo indexer',
      params: { studio: STUDIO_A, quality: '1080p' },
    }),
    event(fKites, 'found', 26 * MINUTE, {
      ...ep(fKites, 2, 4),
      indexer: 'Demo indexer',
    }),
    event(fHarbor, 'unsure', 50 * MINUTE, {
      ...ep(fHarbor, 3, 5, '2160p'),
      indexer: 'Anime indexer',
    }),
    event(fKites, 'pending', 2 * HOUR, {
      ...ep(fKites, 2, 5, '720p'),
      indexer: 'Demo indexer',
      params: { studio: STUDIO_A, quality: '1080p', until: inFuture(9 * HOUR) },
    }),
    event(fKites, 'found', 2 * HOUR + MINUTE, {
      ...ep(fKites, 2, 5, '720p'),
      indexer: 'Demo indexer',
    }),
    event(fHarbor, 'grabbed', 3 * HOUR, {
      ...ep(fHarbor, 3, 4, '2160p'),
      indexer: 'Demo indexer',
      params: { studio: STUDIO_B, quality: '2160p' },
    }),
    event(fHarbor, 'blocklisted', 9 * HOUR, {
      ...ep(fHarbor, 3, 4, '1080p'),
      indexer: 'Public indexer',
      params: { reason: 'stalled' },
    }),
    event(fHarbor, 'failed', 9 * HOUR + MINUTE, {
      ...ep(fHarbor, 3, 4, '1080p'),
      indexer: 'Public indexer',
    }),
    event(fHarbor, 'grabbed', 20 * HOUR, {
      ...ep(fHarbor, 3, 4, '1080p'),
      indexer: 'Public indexer',
      params: { studio: STUDIO_B, quality: '1080p' },
    }),
    event(undefined, 'gap', 22 * HOUR, {
      indexer: 'Anime indexer',
      params: { from: ago(30 * HOUR), to: ago(23 * HOUR) },
    }),
    event(fKites, 'downloaded', DAY, ep(fKites, 2, 3)),
    event(fKites, 'grabbed', DAY + 40 * MINUTE, {
      ...ep(fKites, 2, 3),
      indexer: 'Demo indexer',
      params: { studio: STUDIO_A, quality: '1080p' },
    }),
    event(fHarbor, 'downloaded', 2 * DAY, ep(fHarbor, 3, 3, '2160p')),
    event(fHarbor, 'search', 2 * DAY + HOUR, {
      params: { found: 6, failed: 0, request: 'manual' },
    }),
    event(fBright, 'picked', 3 * DAY, {
      ...ep(fBright, 1, 3, '720p'),
      indexer: 'Demo indexer',
      params: { quality: '720p' },
    }),
    event(fKites, 'upgraded', 4 * DAY, {
      ...ep(fKites, 2, 2),
      indexer: 'Demo indexer',
      params: {
        from: { quality: '720p' },
        to: { studio: STUDIO_A, quality: '1080p' },
      },
    }),
    event(fBright, 'upgraded', 5 * DAY, {
      ...ep(fBright, 1, 2, '720p'),
      indexer: 'Demo indexer',
      params: {
        pick: true,
        from: { quality: '480p' },
        to: { quality: '720p' },
      },
    }),
    event(fKites, 'blocklisted', 6 * DAY, {
      ...ep(fKites, 2, 2, '720p'),
      indexer: 'Public indexer',
      params: { reason: 'user' },
    }),
    event(fBright, 'picked', 7 * DAY, {
      ...ep(fBright, 1, 2, '480p'),
      indexer: 'Public indexer',
      params: { quality: '480p' },
    }),
    event(fSalt, 'downloaded', 70 * DAY, ep(fSalt, 1, 6)),
  ]

  // Фоновые поиски каждые 8 часов: с ними история длиннее одной порции,
  // и «Показать ещё» есть что показать
  const active = [fKites, fHarbor]
  for (let index = 0; index < 42; index++) {
    const follow = active[index % active.length]!
    const found = (index * 7) % 5

    items.push(
      event(follow, 'search', 4 * HOUR + index * 8 * HOUR, {
        params: { found, failed: index % 9 === 4 ? 1 : 0 },
      }),
    )
  }

  activity = items.sort((a, b) => b.at.localeCompare(a.at))

  blocklist = [
    {
      id: 'block-harbor',
      titleId: fHarbor.titleId,
      infoHash: fakeInfohash('block-harbor'),
      releaseTitle: release(fHarbor, 3, 4, '1080p'),
      reason: 'stalled',
      episodes: [{ season: 3, episode: 4 }],
      createdAt: ago(9 * HOUR),
      expiresAt: inFuture(6 * DAY + 15 * HOUR),
    },
    {
      id: 'block-kites',
      titleId: fKites.titleId,
      infoHash: fakeInfohash('block-kites'),
      releaseTitle: release(fKites, 2, 2, '720p'),
      reason: 'user',
      episodes: [{ season: 2, episode: 2 }],
      createdAt: ago(6 * DAY),
      expiresAt: null,
    },
    {
      id: 'block-bright',
      titleId: fBright.titleId,
      infoHash: fakeInfohash('block-bright'),
      releaseTitle: releaseName(brightwater, {
        season: 1,
        quality: '720p.WEB-DL.H.264',
      }),
      reason: 'failed_check',
      episodes: null,
      createdAt: ago(12 * DAY),
      expiresAt: inFuture(18 * DAY),
    },
  ]
}

if (!isFresh)
  seedActivity()

const DEFAULT_SETTINGS: FollowSettings = {
  rssIntervalMin: 15,
  searchesPerHour: 20,
  defaults: {
    waitHours: 24,
    movieWaitHours: 72,
    qualityPreset: 'best',
    requireRussian: 'auto',
    mode: 'download',
  },
  audio: { value: 'ru', source: 'user' },
}

let settings: FollowSettings = structuredClone(DEFAULT_SETTINGS)

/** Запрошенные поиски, время которых пришло, записываются в историю */
function settleSearches() {
  const now = Date.now()

  for (const [id, due] of searchDone) {
    if (due > now)
      continue

    searchDone.delete(id)

    const follow = follows.find(item => item.id === id)
    if (!follow)
      continue

    follow.searchRequested = false
    follow.lastSearchAt = new Date(due).toISOString()
    follow.nextSearchAt = inFuture(6 * HOUR)
    activity.unshift({
      ...event(follow, 'search', (now - due) / 1000),
      params: {
        found: follow.episodes.some(item => item.candidates) ? 3 : 0,
        failed: 0,
        request: 'manual',
      },
    })
  }
}

function unsureOf(followId: string) {
  return activity.filter(
    item =>
      item.kind === 'unsure'
      && item.followId === followId
      && !item.params.confirmedAt
      && !item.params.dismissedAt,
  ).length
}

function detailsOf(follow: DemoFollow): FollowDetails {
  const title = findTitle(follow.titleId)
  const counts = {
    upcoming: 0,
    searching: 0,
    waiting: 0,
    downloading: 0,
    noSpace: 0,
    missing: 0,
    inLibrary: 0,
    ready: 0,
  }

  const first: FollowSummary['first'] = {}

  // Серии демо идут по порядку: первая встреченная и есть первая в состоянии
  for (const item of follow.episodes) {
    const key = FIRST_KEYS[item.state]

    counts[COUNT_KEYS[item.state]]++

    if (key && !first[key])
      first[key] = { season: item.season, episode: item.episode }
  }

  const upcoming = follow.episodes.find(item => item.state === 'upcoming')
  const waits = follow.episodes
    .map(item => item.waitUntil)
    .filter((value): value is string => Boolean(value))
    .sort()

  const server = settings.audio?.value ?? 'ru'

  return {
    ...follow,
    audioEffective: follow.audio ?? server,
    audioServer: server,
    title: title?.title ?? null,
    poster: title && posterOf(title),
    year: title?.year,
    next:
      follow.kind === 'series' && upcoming
        ? {
            season: upcoming.season,
            episode: upcoming.episode,
            airDate: upcoming.airDate,
          }
        : null,
    wanted: follow.episodes.filter(item => WANTED.has(item.state)).length,
    counts,
    first,
    unsure: unsureOf(follow.id),
    waitUntil: waits[0],
  }
}

function summaryOf(follow: DemoFollow): FollowSummary {
  const {
    episodes: _episodes,
    lastSearchAt: _last,
    nextSearchAt: _next,
    searchRequested: _requested,
    ...summary
  } = detailsOf(follow)

  return summary
}

function findFollow(id: string) {
  settleSearches()

  const found = follows.find(item => item.id === id)
  if (!found)
    throw new DemoError(404, { message: 'Follow not found' })

  return found
}

/**
 * Кандидаты серии — готовый результат решателя: лучший берётся (или ждёт
 * окна), остальные отклонены по понятным причинам
 */
function candidatesOf(
  follow: DemoFollow,
  season: number,
  episode: number,
): FollowCandidate[] {
  const state = follow.episodes.find(
    item => item.season === season && item.episode === episode,
  )?.state
  const quality = follow.qualityPreset === 'uhd' ? '2160p' : '1080p'
  const studio = follow.voiceStudio ?? STUDIO_A
  const blocked = new Set(blocklist.map(item => item.infoHash))
  const candidate = (
    seed: string,
    fields: Omit<FollowCandidate, 'id' | 'infoHash' | 'blocked'>,
  ): FollowCandidate => {
    const id = `${follow.id}:${season}:${episode}:${seed}`
    const infoHash = fakeInfohash(id)

    return { id, infoHash, blocked: blocked.has(infoHash), ...fields }
  }

  const best: FollowCandidate['verdict']
    = state === 'downloading'
      ? 'grab'
      : state === 'waiting'
        ? 'pending'
        : 'rejected'
  // Отложенный кандидат хуже желаемого: решатель ждёт лучшую версию
  const offered = state === 'waiting' ? '720p' : quality
  const settled: FollowCandidate['rejections']
    = state === 'searching'
      ? [{ code: 'title_unsure', type: 'temporary' }]
      : [{ code: 'no_wanted', type: 'permanent' }]

  return [
    candidate('best', {
      title: release(follow, season, episode, offered),
      indexers: ['Demo indexer'],
      size: Math.round(
        (offered === '2160p' ? 6.4 : offered === '720p' ? 0.9 : 1.6) * GB,
      ),
      seeders: 48,
      quality: offered,
      studio,
      voiceType: 'D',
      verdict: best,
      rejections:
        best === 'grab'
          ? []
          : best === 'pending'
            ? [
                {
                  code: 'wait',
                  type: 'temporary',
                  params: { studio, quality, until: inFuture(9 * HOUR) },
                },
              ]
            : settled,
    }),
    candidate('low', {
      title: release(follow, season, episode, '480p'),
      indexers: ['Demo indexer', 'Public indexer'],
      size: 420 * MB,
      seeders: 112,
      quality: '480p',
      voiceType: 'MVO',
      verdict: 'rejected',
      rejections: [
        { code: 'quality', type: 'permanent', params: { quality: '480p' } },
      ],
    }),
    candidate('voice', {
      title: release(follow, season, episode, '1080p'),
      indexers: ['Anime indexer'],
      size: Math.round(1.4 * GB),
      seeders: 17,
      quality: '1080p',
      studio: studio === STUDIO_A ? STUDIO_B : STUDIO_A,
      voiceType: 'MVO',
      verdict: 'rejected',
      rejections: follow.voiceStrict
        ? [{ code: 'voice_strict', type: 'permanent', params: { studio } }]
        : [{ code: 'outranked', type: 'permanent' }],
    }),
    candidate('dead', {
      title: release(follow, season, episode, '1080p'),
      indexers: ['Public indexer'],
      size: Math.round(1.5 * GB),
      seeders: 0,
      quality: '1080p',
      verdict: 'rejected',
      rejections: [{ code: 'no_seeders', type: 'temporary' }],
    }),
  ]
}

function queueItems(): FollowQueueItem[] {
  const items: FollowQueueItem[] = []

  for (const follow of follows) {
    if (follow.state !== 'active' && follow.state !== 'paused')
      continue

    for (const episode of follow.episodes) {
      const base = {
        followId: follow.id,
        titleId: follow.titleId,
        followState: follow.state,
        season: episode.season,
        episodes: [episode.episode],
      }

      if (episode.state === 'downloading') {
        const size = Math.round(
          (follow.qualityPreset === 'uhd' ? 6.4 : 1.6) * GB,
        )
        // Прогресс идёт от времени демо, у каждой серии своя скорость
        const start = (episode.episode * 0.17) % 0.6
        const progress = Math.min(
          0.99,
          start
          + elapsedSeconds() / (follow.qualityPreset === 'uhd' ? 1500 : 600),
        )

        items.push({
          ...base,
          kind: 'downloading',
          releaseTitle: release(
            follow,
            episode.season,
            episode.episode,
            follow.qualityPreset === 'uhd' ? '2160p' : '1080p',
          ),
          size,
          progress,
        })
      }
      else if (episode.state === 'waiting') {
        items.push({
          ...base,
          kind: 'pending',
          releaseTitle: release(
            follow,
            episode.season,
            episode.episode,
            '720p',
          ),
          until: episode.waitUntil,
          waitFor: {
            studio: follow.voiceStudio ?? undefined,
            quality: '1080p',
          },
          size: 900 * MB,
        })
      }
    }
  }

  return items
}

get<FollowListResponse>('/api/follows', () => {
  settleSearches()
  return { items: follows.map(summaryOf) }
})

get<FollowDetails>('/api/follows/:id', ({ params }) =>
  detailsOf(findFollow(params.id!)))

patch<FollowDetails, UpdateFollowInput>(
  '/api/follows/:id',
  ({ params, body }) => {
    const follow = findFollow(params.id!)
    const { state, ...rules } = body

    Object.assign(follow, rules, { updatedAt: new Date().toISOString() })

    // Готовое и остановленное слежение паузой не возобновляется
    if (state && (follow.state === 'active' || follow.state === 'paused')) {
      follow.state = state
      follow.nextSearchAt = state === 'active' ? inFuture(15 * MINUTE) : null
    }

    return detailsOf(follow)
  },
)

del<MessageResponse>('/api/follows/:id', ({ params }) => {
  const follow = findFollow(params.id!)

  follows = follows.filter(item => item.id !== follow.id)
  searchDone.delete(follow.id)

  return { message: 'Follow deleted' }
})

get<FollowCandidatesResponse>(
  '/api/follows/:id/candidates',
  ({ params, query }) => {
    const follow = findFollow(params.id!)
    const season = Number(query.get('season'))
    const episode = Number(query.get('episode'))
    const found = follow.episodes.find(
      item => item.season === season && item.episode === episode,
    )

    if (!found?.candidates)
      return { firstSeenAt: null, items: [] }

    return {
      firstSeenAt: ago(found.state === 'waiting' ? 2 * HOUR : 3 * DAY),
      items: candidatesOf(follow, season, episode).slice(0, found.candidates),
    }
  },
)

post<MessageResponse>('/api/follows/:id/search', ({ params }) => {
  const follow = findFollow(params.id!)

  if (follow.state !== 'active')
    throw new DemoError(409, { message: 'follow_not_active' })

  follow.searchRequested = true
  searchDone.set(follow.id, Date.now() + SEARCH_MS)

  return { message: 'Search requested' }
})

get<FollowActivityResponse>('/api/follow/activity', ({ query }) => {
  settleSearches()

  const follow = query.get('follow')
  const kind = query.get('kind')
  const before = query.get('before')
  const limit = Math.min(
    100,
    Math.max(1, Number(query.get('limit') ?? 50) || 50),
  )
  let rows = activity.filter(
    item =>
      (!follow || item.followId === follow) && (!kind || item.kind === kind),
  )

  if (before) {
    const index = rows.findIndex(item => item.id === before)
    rows = index < 0 ? [] : rows.slice(index + 1)
  }

  return { items: rows.slice(0, limit), hasMore: rows.length > limit }
})

function answerUnsure(id: string, field: 'confirmedAt' | 'dismissedAt') {
  const item = activity.find(row => row.id === id && row.kind === 'unsure')
  if (!item)
    throw new DemoError(404, { message: 'Entry not found' })

  item.params = { ...item.params, [field]: new Date().toISOString() }
}

post<MessageResponse>('/api/follow/unsure/:id/confirm', ({ params }) => {
  answerUnsure(params.id!, 'confirmedAt')
  return { message: 'Release confirmed' }
})

post<MessageResponse>('/api/follow/unsure/:id/dismiss', ({ params }) => {
  answerUnsure(params.id!, 'dismissedAt')
  return { message: 'Release dismissed' }
})

get<FollowQueueResponse>('/api/follow/queue', () => ({ items: queueItems() }))

get<BlocklistResponse>('/api/follow/blocklist', () => ({
  items: blocklist.filter(
    item => !item.expiresAt || item.expiresAt > new Date().toISOString(),
  ),
}))

post<MessageResponse, BlockReleaseInput>(
  '/api/follow/blocklist',
  ({ body }) => {
    const follow = findFollow(body.followId)
    const [season, episode] = body.candidateId
      .slice(follow.id.length + 1)
      .split(':')
      .map(Number)
    const candidate
      = season !== undefined && episode !== undefined
        ? candidatesOf(follow, season, episode).find(
            item => item.id === body.candidateId,
          )
        : undefined

    if (!candidate)
      throw new DemoError(404, { message: 'Release not found' })

    const id = nextId('block')

    blocklist.unshift({
      id,
      titleId: follow.titleId,
      infoHash: candidate.infoHash ?? null,
      releaseTitle: candidate.title,
      reason: 'user',
      episodes: [{ season: season!, episode: episode! }],
      createdAt: new Date().toISOString(),
      expiresAt: null,
    })
    activity.unshift(
      event(follow, 'blocklisted', 0, {
        season: season!,
        episodes: [episode!],
        releaseTitle: candidate.title,
        indexer: candidate.indexers[0] ?? null,
        params: { reason: 'user' },
      }),
    )

    return { message: 'Release blocked' }
  },
)

del<MessageResponse>('/api/follow/blocklist/:id', ({ params }) => {
  if (!blocklist.some(item => item.id === params.id))
    throw new DemoError(404, { message: 'Entry not found' })

  blocklist = blocklist.filter(item => item.id !== params.id)
  return { message: 'Entry removed' }
})

get<FollowSettings>('/api/settings/follow', () => settings)

put<FollowSettings, UpdateFollowSettingsInput>(
  '/api/settings/follow',
  ({ body }) => {
    settings = {
      rssIntervalMin: body.rssIntervalMin ?? settings.rssIntervalMin,
      searchesPerHour: body.searchesPerHour ?? settings.searchesPerHour,
      defaults: { ...settings.defaults, ...body.defaults },
      audio: body.audio
        ? { value: body.audio, source: 'user' }
        : settings.audio,
    }

    return settings
  },
)

/**
 * Проблемы «Следить» для «Требует внимания»: серии действующих слежений,
 * которые ждут места. Без действующих слежений проблем нет: фон не качает.
 */
export function followAttention(): AttentionItem[] {
  const active = follows.filter(item => item.state === 'active')
  const waiting = active.flatMap(follow =>
    follow.episodes.filter(item => item.state === 'no_space'),
  )

  if (!waiting.length)
    return []

  return [
    {
      kind: 'follow_no_space',
      severity: 'error',
      section: 'follow',
      params: { count: waiting.length },
    },
  ]
}
