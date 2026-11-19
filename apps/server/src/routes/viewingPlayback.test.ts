import type { ViewingCheckpoint, ViewingStart } from '../dto/viewing.ts'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import {
  ACCESS_TOKEN_COOKIE,
  config,
  DEVICE_TOKEN_COOKIE,
  PROFILE_COOKIE,
} from '../config.ts'
import { getDb, MIGRATIONS_DIR } from '../db/index.ts'
import {
  cyclePlaybackFacts,
  cycleProgress,
  devices,
  diaryEntries,
  diarySeen,
  libraries,
  libraryFolders,
  mediaFiles,
  mineTitlePreferences,
  profileTitles,
  rewatchCycles,
  serverSettings,
  titleProgress,
  users,
  watchEvents,
} from '../db/schema.ts'
import { calendarDayAt } from '../services/mine/calendar.ts'
import { storeMetaCache } from '../services/tmdb/cache.ts'
import { recommendationList } from '../services/tmdb/recommendations.ts'
import { stopAllSessions } from '../services/media/index.ts'
import { createProfile, defaultProfile } from '../services/profiles/index.ts'
import { getTitleProgress } from '../services/sources/progress.ts'
import { parseExportDocument } from '../services/transfer/document.ts'
import { buildExport } from '../services/transfer/export.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const cookies = {
  [ACCESS_TOKEN_COOKIE]: signToken('viewing-owner', 'user_access'),
}
const dir = mkdtempSync(join(tmpdir(), 'torsher-viewing-test-'))
let sqlite: Database.Database
let dbFile: string
let profileId: string
let folderId: string
const movie = { id: 'tmdb:movie:90201' }
const episode = { id: 'tmdb:tv:90202', season: 1, episode: 1 }
interface Title {
  id: string
  season?: number
  episode?: number
}

// Swap the underlying file connection while using the same routes and queries.
const dbHolder = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof getDb> | undefined,
  beforeStat: undefined as ((path: string) => Promise<void> | void) | undefined,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      await dbHolder.beforeStat?.(String(args[0]))
      return actual.stat(...args)
    },
  }
})
vi.mock('../db/index.ts', async (original) => {
  const entry = await original<typeof import('../db/index.ts')>()
  return { ...entry, getDb: () => dbHolder.db ?? entry.getDb() }
})

function openFixture() {
  sqlite = new Database(dbFile)
  sqlite.pragma('foreign_keys = ON')
  sqlite.function('mine_day_at', { deterministic: true }, (time, zone) =>
    calendarDayAt(time as number, zone as string))
  dbHolder.db = drizzle(sqlite) as ReturnType<typeof getDb>
}

beforeAll(async () => {
  expect(config.databasePath).toBe(':memory:')
  await app.ready()
})

beforeEach(() => {
  dbFile = join(dir, `${randomUUID()}.sqlite`)
  openFixture()
  migrate(getDb(), { migrationsFolder: MIGRATIONS_DIR })
  const db = getDb()
  db.insert(users)
    .values({ id: 'viewing-owner', username: 'Owner', passwordHash: 'fixture' })
    .run()
  profileId = defaultProfile().id
  const libraryId = db
    .insert(libraries)
    .values({ kind: 'video', name: 'Test library' })
    .returning()
    .get()
    .id
  folderId = db
    .insert(libraryFolders)
    .values({ libraryId, path: dir })
    .returning()
    .get()
    .id
})

afterEach(async () => {
  await stopAllSessions()
  sqlite.close()
  dbHolder.db = undefined
  dbHolder.beforeStat = undefined
})

afterAll(async () => {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})

function file(title: Title) {
  const relPath = `${randomUUID()}.mp4`
  const path = join(dir, relPath)
  writeFileSync(path, 'local test bytes')
  const row = getDb()
    .insert(mediaFiles)
    .values({
      folderId,
      relPath,
      size: 16,
      mtime: new Date(),
      titleId: title.id,
      season: title.season ?? 0,
      episode: title.episode ?? 0,
    })
    .returning()
    .get()
  return { mediaFileId: row.id, path }
}

function intent(
  requestId: string,
  clientId = 'client-a',
  playerId = 'player-a',
): ViewingStart {
  return { requestId, clientId, playerId, intent: 'join' }
}

function start(mediaFileId: string, title: Title, viewing: ViewingStart) {
  return app.inject({
    method: 'POST',
    url: '/api/playback',
    cookies,
    payload: { mediaFileId, title, viewing },
  })
}

interface Started {
  sessionId: string
  viewing: { attemptId: string, generation: number, state: string }
  startPosition: number | null
}

async function play(mediaFileId: string, title: Title, viewing: ViewingStart) {
  const response = await start(mediaFileId, title, viewing)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Started>()
}

function put(payload: object, viewer = profileId) {
  return app.inject({
    method: 'PUT',
    url: '/api/watch-state',
    cookies: { ...cookies, [PROFILE_COOKIE]: viewer },
    payload,
  })
}

function checkpoint(
  sessionId: string,
  mediaFileId: string,
  title: Title,
  viewer: ViewingStart,
  sequence: number,
  position: number,
  kind: ViewingCheckpoint['kind'] = 'playback',
  line = 0,
  duration: number | null = 1000,
) {
  return put({
    sessionId,
    mediaFileId,
    title,
    position,
    duration: duration ?? undefined,
    event: { clientId: viewer.clientId, sequence },
    viewing: { kind, playerId: viewer.playerId, line },
  })
}

async function accepted(
  response: ReturnType<typeof checkpoint>,
  expected = true,
) {
  const result = await response
  expect(result.statusCode, result.body).toBe(200)
  expect(result.json().accepted).toBe(expected)
  return result.json()
}

it('keeps a durable receipt, accepts stop after reopening and does not recreate a deleted entry', async () => {
  const { mediaFileId } = file(movie)
  const command = intent('request-one')
  const first = await play(mediaFileId, movie, command)
  expect(first.viewing).toMatchObject({ generation: 1, state: 'open' })
  expect(
    getDb()
      .select()
      .from(serverSettings)
      .all()
      .some(row => row.key === 'mine.diaryTimeZone'),
  ).toBe(true)
  expect(
    (await start(file(movie).mediaFileId, movie, command)).statusCode,
  ).toBe(409)
  await accepted(
    checkpoint(first.sessionId, mediaFileId, movie, command, 1, 850),
  )
  await accepted(
    checkpoint(first.sessionId, mediaFileId, movie, command, 2, 890),
  )
  expect(getDb().select().from(diaryEntries).all()).toHaveLength(0)

  const closed = await app.inject({
    method: 'DELETE',
    url: `/api/playback/${first.sessionId}`,
    cookies,
  })
  expect(closed.statusCode).toBe(200)
  await stopAllSessions()
  sqlite.close()
  openFixture()

  await accepted(
    checkpoint(first.sessionId, mediaFileId, movie, command, 3, 900, 'stop'),
  )
  const retry = await play(mediaFileId, movie, command)
  expect(retry.viewing).toEqual({ ...first.viewing, state: 'completed' })
  expect((await play(mediaFileId, movie, intent('new-join'))).viewing).toEqual(
    retry.viewing,
  )
  expect(getDb().select().from(diaryEntries).get()).toMatchObject({
    origin: 'playback',
    originKey: first.viewing.attemptId,
    precision: 'instant',
    day: null,
    rewatch: false,
  })
  const exported = JSON.stringify(buildExport({ scope: 'profile', profileId }))
  expect(parseExportDocument(exported)).toMatchObject({
    version: 2,
    personalSpace: {
      diary: [
        {
          title: movie.id,
          originKey: first.viewing.attemptId,
          origin: 'playback',
        },
      ],
      seen: [{ title: movie.id }],
    },
  })
  expect(exported).not.toContain(first.sessionId)
  expect(exported).not.toContain(command.requestId)
  getDb().delete(diaryEntries).run()
  await accepted(
    checkpoint(first.sessionId, mediaFileId, movie, command, 4, 940),
  )
  expect(getDb().select().from(diaryEntries).all()).toHaveLength(0)
  expect(getDb().select().from(diarySeen).all()).toHaveLength(1)
})

it('uses restart CAS and refuses an old generation before any progress or watermark write', async () => {
  const { mediaFileId } = file(movie)
  const firstIntent = intent('original')
  const first = await play(mediaFileId, movie, firstIntent)
  await accepted(
    checkpoint(first.sessionId, mediaFileId, movie, firstIntent, 1, 850),
  )
  await accepted(
    checkpoint(first.sessionId, mediaFileId, movie, firstIntent, 2, 910),
  )
  const previousWatched = getTitleProgress({
    profileId,
    titleId: movie.id,
  })?.watchedAt
  expect(previousWatched).toBeInstanceOf(Date)
  const one = {
    ...intent('restart-one'),
    intent: 'restart' as const,
    expectedGeneration: first.viewing.generation,
  }
  const two = { ...one, requestId: 'restart-two' }
  const results = await Promise.all([
    start(mediaFileId, movie, one),
    start(mediaFileId, movie, two),
  ])
  expect(results.map(result => result.statusCode).sort()).toEqual([200, 409])
  const winner = results[0]!.statusCode === 200 ? one : two
  const second = results
    .find(result => result.statusCode === 200)!
    .json<Started>()
  expect(second.viewing).toMatchObject({ state: 'open', generation: 2 })
  expect(second.startPosition).toBe(0)
  expect(
    (await play(mediaFileId, movie, { ...winner, playerId: 'reloaded-player' }))
      .viewing,
  ).toEqual(second.viewing)

  const watermarks = getDb().select().from(watchEvents).all()
  const normal = getTitleProgress({ profileId, titleId: movie.id })
  expect(
    await accepted(
      checkpoint(
        first.sessionId,
        mediaFileId,
        movie,
        firstIntent,
        500,
        990,
        'stop',
      ),
      false,
    ),
  ).toMatchObject({ rejection: 'viewingConflict' })
  expect(getDb().select().from(watchEvents).all()).toEqual(watermarks)
  expect(getTitleProgress({ profileId, titleId: movie.id })).toEqual(normal)

  await accepted(
    checkpoint(second.sessionId, mediaFileId, movie, winner, 3, 350),
  )
  const resume = await play(
    mediaFileId,
    movie,
    intent('resume', 'client-b', 'player-b'),
  )
  expect(resume.viewing).toEqual(second.viewing)
  expect(resume.startPosition).toBe(350)
  expect(getTitleProgress({ profileId, titleId: movie.id })?.watchedAt).toEqual(
    previousWatched,
  )
  expect(
    (await start(mediaFileId, movie, { ...winner, expectedGeneration: 2 }))
      .statusCode,
  ).toBe(409)
  const old = await play(mediaFileId, movie, firstIntent)
  expect(old.viewing).toMatchObject({
    generation: 1,
    state: 'completed',
    current: false,
  })
  expect(
    (
      await start(mediaFileId, movie, {
        ...intent('reconnect-to-old'),
        expectedGeneration: 1,
      })
    ).statusCode,
  ).toBe(409)
})

it('does not combine devices, replacement files or a seek delivered after its next heartbeat', async () => {
  const source = file(movie)
  const a = intent('a')
  const b = intent('b', 'client-b', 'player-b')
  const first = await play(source.mediaFileId, movie, a)
  const second = await play(source.mediaFileId, movie, b)
  expect(second.viewing).toEqual(first.viewing)
  await accepted(
    checkpoint(first.sessionId, source.mediaFileId, movie, a, 1, 400),
  )
  await accepted(
    checkpoint(second.sessionId, source.mediaFileId, movie, b, 1, 950),
  )
  await accepted(
    checkpoint(second.sessionId, source.mediaFileId, movie, b, 2, 1000, 'stop'),
  )
  expect(getDb().select().from(diaryEntries).all()).toHaveLength(0)
  await accepted(
    checkpoint(
      first.sessionId,
      source.mediaFileId,
      movie,
      a,
      3,
      960,
      'playback',
      1,
    ),
  )
  expect(
    await accepted(
      checkpoint(
        first.sessionId,
        source.mediaFileId,
        movie,
        a,
        2,
        955,
        'seek',
        1,
      ),
      false,
    ),
  ).toMatchObject({ rejection: 'stale' })
  await accepted(
    checkpoint(
      first.sessionId,
      source.mediaFileId,
      movie,
      a,
      4,
      980,
      'playback',
      0,
    ),
    false,
  )
  expect(getDb().select().from(diaryEntries).all()).toHaveLength(0)

  writeFileSync(source.path, 'different bytes replacing the original movie')
  await accepted(
    checkpoint(
      first.sessionId,
      source.mediaFileId,
      movie,
      a,
      5,
      990,
      'playback',
      1,
    ),
    false,
  )
  const replacementIntent = intent('replacement')
  const replacement = await play(source.mediaFileId, movie, replacementIntent)
  await accepted(
    checkpoint(
      replacement.sessionId,
      source.mediaFileId,
      movie,
      replacementIntent,
      4,
      950,
    ),
  )
  await accepted(
    checkpoint(
      replacement.sessionId,
      source.mediaFileId,
      movie,
      replacementIntent,
      5,
      970,
      'playback',
      0,
      null,
    ),
  )
  expect(getDb().select().from(diaryEntries).all()).toHaveLength(0)
  await accepted(
    checkpoint(
      replacement.sessionId,
      source.mediaFileId,
      movie,
      replacementIntent,
      6,
      975,
    ),
  )
  expect(getDb().select().from(diaryEntries).all()).toHaveLength(1)
})

it('rejects a partial or foreign binding without applying progress', async () => {
  const { mediaFileId } = file(movie)
  const command = intent('secure')
  const { sessionId } = await play(mediaFileId, movie, command)
  const base = { mediaFileId, sessionId, title: movie, position: 99 }
  expect(
    (await put({ ...base, viewing: { playerId: 'player-a' } })).statusCode,
  ).toBe(400)
  expect((await put(base)).statusCode).toBe(404)

  const other = createProfile({
    name: 'Other',
    color: 'violet',
    language: null,
    ageLimit: null,
  })
  const mismatchedStart = await app.inject({
    method: 'POST',
    url: '/api/playback',
    cookies: { ...cookies, [PROFILE_COOKIE]: other.id },
    payload: {
      mediaFileId,
      title: movie,
      profileId,
      viewing: intent('old-viewer'),
    },
  })
  expect(mismatchedStart.statusCode).toBe(404)
  const event = { clientId: command.clientId, sequence: 1 }
  const validEnvelope = {
    kind: 'playback',
    line: 0,
    playerId: command.playerId,
  }
  const wrongProfile = await put(
    { ...base, event, viewing: validEnvelope },
    other.id,
  )
  expect(wrongProfile.json()).toMatchObject({ accepted: false, position: 0 })
  await accepted(
    checkpoint(
      sessionId,
      mediaFileId,
      { id: 'tmdb:movie:90203' },
      command,
      2,
      99,
    ),
    false,
  )
  await accepted(
    checkpoint(
      sessionId,
      mediaFileId,
      movie,
      intent('fake', 'client-a', 'fake-player'),
      3,
      99,
    ),
    false,
  )
  expect(getDb().select().from(watchEvents).all()).toHaveLength(0)
  expect(getDb().select().from(titleProgress).all()).toHaveLength(0)
  expect(
    (await put({ mediaFileId, title: movie, position: 120 })).statusCode,
  ).toBe(200)
  expect(getTitleProgress({ profileId, titleId: movie.id })?.position).toBe(
    120,
  )
})

it('keeps native cycle facts, watched history and legacy cursor separate', async () => {
  const { mediaFileId } = file(episode)
  const ref = {
    profileId,
    titleId: episode.id,
    season: episode.season,
    episode: episode.episode,
  }
  await put({ mediaFileId, title: episode, position: 200, duration: 1000 })
  const before = getTitleProgress(ref)
  const now = new Date()
  const cycle = getDb()
    .insert(rewatchCycles)
    .values({
      profileId,
      titleId: episode.id,
      startSeason: 1,
      startEpisode: 1,
      targetSeason: 1,
      targetEpisode: 1,
      state: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  getDb()
    .insert(mineTitlePreferences)
    .values({
      profileId,
      titleId: episode.id,
      continuation: 'hidden',
      updatedAt: now,
    })
    .run()
  const command = { ...intent('cycle'), cycleId: cycle.id }
  const first = await play(mediaFileId, episode, command)
  expect(first.startPosition).toBe(null)
  await accepted(
    checkpoint(
      first.sessionId,
      mediaFileId,
      episode,
      command,
      1,
      920,
      'seek',
      1,
    ),
  )
  expect(getDb().select().from(cyclePlaybackFacts).all()).toHaveLength(0)
  await accepted(
    checkpoint(
      first.sessionId,
      mediaFileId,
      episode,
      command,
      2,
      910,
      'playback',
      1,
    ),
  )
  await accepted(
    checkpoint(
      first.sessionId,
      mediaFileId,
      episode,
      command,
      3,
      920,
      'playback',
      1,
      90,
    ),
  )
  expect(getDb().select().from(diaryEntries).all()).toHaveLength(0)
  expect(getDb().select().from(diarySeen).all()).toHaveLength(0)
  expect(getDb().select().from(cyclePlaybackFacts).get()).toMatchObject({
    watchedAt: null,
    lastPlayedAt: expect.any(Date),
  })
  await accepted(
    checkpoint(
      first.sessionId,
      mediaFileId,
      episode,
      command,
      4,
      930,
      'playback',
      1,
    ),
  )
  expect(getTitleProgress(ref)).toEqual(before)
  expect(getDb().select().from(cycleProgress).get()).toMatchObject({
    position: 930,
    cycleId: cycle.id,
  })
  expect(getDb().select().from(cyclePlaybackFacts).get()).toMatchObject({
    watchedAt: expect.any(Date),
    lastPlayedAt: expect.any(Date),
  })
  expect(getDb().select().from(mineTitlePreferences).get()?.continuation).toBe(
    'normal',
  )
  expect(getDb().select().from(diaryEntries).get()).toMatchObject({
    context: { kind: 'cycle', cycleId: cycle.id },
    rewatch: true,
  })
  const resolve = await app.inject({
    method: 'GET',
    url: '/api/playback/viewing-attempt',
    query: {
      titleId: episode.id,
      season: '1',
      episode: '1',
      cycleId: cycle.id,
    },
    cookies,
  })
  expect(resolve.json()).toMatchObject({ source: { mediaFileId } })

  await put({ mediaFileId, title: episode, position: 300, duration: 1000 })
  expect(getTitleProgress(ref)?.position).toBe(300)
  expect(getDb().select().from(cycleProgress).get()?.position).toBe(930)
  const unwatched = await app.inject({
    method: 'PUT',
    url: `/api/titles/${episode.id}/watched`,
    cookies,
    payload: { season: 1, episode: 1, watched: false },
  })
  expect(unwatched.statusCode, unwatched.body).toBe(200)
  expect(getDb().select().from(diarySeen).all()).toHaveLength(0)
  expect(getDb().select().from(diaryEntries).all()).toHaveLength(1)
  expect(getDb().select().from(cyclePlaybackFacts).get()).toMatchObject({
    watchedAt: null,
    lastPlayedAt: expect.any(Date),
  })
})

it('resumes cycle episodes independently, ignores older episode tails and revokes starts across pause', async () => {
  const firstEpisode = { id: episode.id, season: 2, episode: 1 }
  const nextEpisode = { ...firstEpisode, episode: 2 }
  const firstFile = file(firstEpisode)
  const secondFile = file(nextEpisode)
  const language = 'en-US'
  const creation = {
    expectedProfileId: profileId,
    language,
    requestId: randomUUID(),
    season: 2,
    episode: 1,
  }
  const create = (payload = creation) =>
    app.inject({
      method: 'POST',
      url: `/api/mine/v1/title/${episode.id}/cycles`,
      cookies,
      payload,
    })
  const initial = await create()
  expect(initial.statusCode, initial.body).toBe(200)
  const { id: cycleId } = initial.json()
  expect((await create()).json()).toEqual(initial.json())
  expect((await create({ ...creation, episode: 2 })).statusCode).toBe(409)
  expect(
    (await create({ ...creation, requestId: randomUUID() })).statusCode,
  ).toBe(409)

  const cycleAction = async (action: 'pause' | 'resume' | 'end') => {
    const result = await app.inject({
      method: 'PATCH',
      url: `/api/mine/v1/cycles/${cycleId}`,
      cookies,
      payload: { expectedProfileId: profileId, language, action },
    })
    expect(result.statusCode, result.body).toBe(200)
    return result.json()
  }
  const mineContinue = async () => {
    const result = await app.inject({
      url: '/api/mine/v1/continue',
      cookies,
      query: { expectedProfileId: profileId, language },
    })
    expect(result.statusCode, result.body).toBe(200)
    return result.json()
  }
  expect(await mineContinue()).toMatchObject({
    items: [
      {
        cycle: { resume: { season: 2, episode: 1, position: 0 } },
        normalResume: null,
      },
    ],
  })

  // A pre-existing ordinary cursor remains visible when the cycle is paused or ended.
  await put({
    mediaFileId: firstFile.mediaFileId,
    title: firstEpisode,
    position: 200,
    duration: 1000,
  })
  const firstCommand = { ...intent('cycle-first'), cycleId }
  const first = await play(firstFile.mediaFileId, firstEpisode, firstCommand)
  await accepted(
    checkpoint(
      first.sessionId,
      firstFile.mediaFileId,
      firstEpisode,
      firstCommand,
      1,
      860,
    ),
  )
  await accepted(
    checkpoint(
      first.sessionId,
      firstFile.mediaFileId,
      firstEpisode,
      firstCommand,
      2,
      890,
    ),
  )
  await accepted(
    checkpoint(
      first.sessionId,
      firstFile.mediaFileId,
      firstEpisode,
      firstCommand,
      3,
      910,
      'stop',
    ),
  )
  expect(
    getDb().select().from(cycleProgress).get()?.completedAt,
  ).toBeInstanceOf(Date)
  getDb().delete(diaryEntries).run()
  expect(await mineContinue()).toMatchObject({
    items: [{ cycle: { resume: { season: 2, episode: 2, next: true } } }],
  })

  const secondCommand = { ...intent('cycle-second'), cycleId }
  const second = await play(secondFile.mediaFileId, nextEpisode, secondCommand)
  await accepted(
    checkpoint(
      first.sessionId,
      firstFile.mediaFileId,
      firstEpisode,
      firstCommand,
      4,
      940,
      'stop',
    ),
  )
  await accepted(
    checkpoint(
      second.sessionId,
      secondFile.mediaFileId,
      nextEpisode,
      secondCommand,
      5,
      120,
    ),
  )
  expect(await mineContinue()).toMatchObject({
    items: [
      {
        cycle: {
          target: { season: 2, episode: 2 },
          resume: { season: 2, episode: 2, position: 120 },
        },
      },
    ],
  })

  const enteredStat = Promise.withResolvers<void>()
  const releaseStat = Promise.withResolvers<void>()
  dbHolder.beforeStat = async (path) => {
    if (path === secondFile.path) {
      enteredStat.resolve()
      await releaseStat.promise
    }
  }
  const pending = start(secondFile.mediaFileId, nextEpisode, {
    ...intent('cycle-in-flight'),
    cycleId,
  })
  const statWasReached = pending.then(() => false)
  try {
    expect(
      await Promise.race([
        enteredStat.promise.then(() => true),
        statWasReached,
      ]),
    ).toBe(true)
    expect(await cycleAction('pause')).toMatchObject({
      state: 'paused',
      resume: null,
    })
    expect(await mineContinue()).toMatchObject({
      items: [{ normalResume: { season: 2, episode: 1, position: 200 } }],
    })
    expect(await cycleAction('resume')).toMatchObject({ state: 'active' })
  }
  finally {
    releaseStat.resolve()
    dbHolder.beforeStat = undefined
  }
  expect((await pending).statusCode).toBe(404)
  expect(
    (await start(secondFile.mediaFileId, nextEpisode, secondCommand))
      .statusCode,
  ).toBe(409)
  await accepted(
    checkpoint(
      second.sessionId,
      secondFile.mediaFileId,
      nextEpisode,
      secondCommand,
      6,
      300,
    ),
    false,
  )

  const freshCommand = { ...intent('cycle-fresh'), cycleId }
  const fresh = await play(secondFile.mediaFileId, nextEpisode, freshCommand)
  expect(fresh.startPosition).toBe(120)
  await put({
    mediaFileId: firstFile.mediaFileId,
    title: firstEpisode,
    position: 350,
    duration: 1000,
  })
  expect(await cycleAction('end')).toMatchObject({ state: 'ended' })
  expect(await mineContinue()).toMatchObject({
    items: [{ cycle: null, normalResume: { position: 350 } }],
  })
  expect((await create()).json()).toMatchObject({
    id: cycleId,
    state: 'ended',
  })
})

it('discards a delayed viewing-attempt lookup after the paired device selects another profile', async () => {
  const fixture = file(episode)
  const db = getDb()
  const now = new Date()
  const cycle = db
    .insert(rewatchCycles)
    .values({
      profileId,
      titleId: episode.id,
      startSeason: 1,
      startEpisode: 1,
      targetSeason: 1,
      targetEpisode: 1,
      state: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  const command = { ...intent('for-device'), cycleId: cycle.id }
  const session = await play(fixture.mediaFileId, episode, command)
  await accepted(
    checkpoint(
      session.sessionId,
      fixture.mediaFileId,
      episode,
      command,
      1,
      100,
    ),
  )

  const token = 'test-device-token'
  const paired = db
    .insert(devices)
    .values({
      name: 'TV',
      type: 'tv',
      profileId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
    })
    .returning()
    .get()
  const guest = createProfile({
    name: 'Guest',
    color: 'blue',
    ageLimit: null,
    language: null,
  })
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  dbHolder.beforeStat = async (path) => {
    if (path === fixture.path) {
      entered.resolve()
      await release.promise
    }
  }
  const pending = app.inject({
    url: '/api/playback/viewing-attempt',
    query: {
      titleId: episode.id,
      season: '1',
      episode: '1',
      cycleId: cycle.id,
      profileId,
    },
    cookies: { [DEVICE_TOKEN_COOKIE]: token },
  })
  try {
    expect(
      await Promise.race([
        entered.promise.then(() => true),
        pending.then(() => false),
      ]),
    ).toBe(true)
    db.update(devices)
      .set({ profileId: guest.id })
      .where(eq(devices.id, paired.id))
      .run()
  }
  finally {
    release.resolve()
    dbHolder.beforeStat = undefined
  }
  const response = await pending
  expect(response.statusCode, response.body).toBe(404)
  expect(response.json()).not.toHaveProperty('attempt')
  expect(response.json()).not.toHaveProperty('source')
})

it('resets only the cycle cursor on an explicit restart of a completed episode', async () => {
  const fixture = file(episode)
  file({ ...episode, episode: 2 })
  const db = getDb()
  const now = new Date()
  const cycle = db
    .insert(rewatchCycles)
    .values({
      profileId,
      titleId: episode.id,
      startSeason: 1,
      startEpisode: 1,
      targetSeason: 1,
      targetEpisode: 1,
      state: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  const ref = { profileId, titleId: episode.id, season: 1, episode: 1 }
  await put({
    mediaFileId: fixture.mediaFileId,
    title: episode,
    position: 250,
    duration: 1000,
  })
  const normal = getTitleProgress(ref)

  const join = { ...intent('first-playback'), cycleId: cycle.id }
  const played = await play(fixture.mediaFileId, episode, join)
  await accepted(
    checkpoint(played.sessionId, fixture.mediaFileId, episode, join, 1, 870),
  )
  await accepted(
    checkpoint(played.sessionId, fixture.mediaFileId, episode, join, 2, 910),
  )
  const before = db.select().from(cycleProgress).get()!
  const facts = db.select().from(cyclePlaybackFacts).get()
  expect(before.completedAt).toBeInstanceOf(Date)

  const restart = {
    ...intent('restart-playback'),
    cycleId: cycle.id,
    intent: 'restart' as const,
    expectedGeneration: 1,
  }
  const reset = await play(fixture.mediaFileId, episode, restart)
  expect(reset.startPosition).toBe(0)
  const cursor = db.select().from(cycleProgress).get()!
  expect(cursor).toMatchObject({ position: 0, completedAt: null })
  expect(cursor.updatedAt.getTime()).toBeGreaterThan(
    before.updatedAt.getTime(),
  )
  expect(db.select().from(cyclePlaybackFacts).get()).toEqual(facts)
  expect(getTitleProgress(ref)).toEqual(normal)
  expect(
    (await play(fixture.mediaFileId, episode, restart)).viewing.generation,
  ).toBe(2)
  await accepted(
    checkpoint(reset.sessionId, fixture.mediaFileId, episode, restart, 3, 50),
  )
  const continued = await app.inject({
    url: '/api/mine/v1/continue',
    query: { expectedProfileId: profileId },
    cookies,
  })
  expect(continued.json()).toMatchObject({
    items: [{ cycle: { resume: { episode: 1, position: 50, next: false } } }],
  })
  expect(db.select().from(diaryEntries).all()).toHaveLength(1)
  const exportDoc = parseExportDocument(
    JSON.stringify(buildExport({ scope: 'profile', profileId })),
  )
  expect(exportDoc).toMatchObject({
    personalSpace: {
      cycleProgress: [{ episode: 1, position: 50, completedAt: null }],
    },
  })
})

it('offers a finished film again after unwatch keeps its maintenance timestamp and diary fact', async () => {
  const db = getDb()
  const seedId = 'tmdb:movie:90219'
  db.insert(profileTitles)
    .values({
      profileId,
      titleId: seedId,
      rating: 9,
      ratedAt: new Date(),
    })
    .run()
  storeMetaCache(
    recommendationList({ type: 'movie', tmdbId: 90219 }, 'en-US').key,
    {
      results: [
        { id: 90201, title: 'Evening Signal', release_date: '2024-01-02' },
      ],
    },
  )
  const suggestions = async () => {
    const response = await app.inject({
      url: '/api/mine/v1/recommendations',
      query: {
        expectedProfileId: profileId,
        language: 'en-US',
        refresh: 'poll',
      },
      cookies,
    })
    expect(response.statusCode, response.body).toBe(200)
    return response.json()
  }
  const { mediaFileId } = file(movie)
  const command = intent('recommendations-through-unwatch')
  const { sessionId } = await play(mediaFileId, movie, command)
  await accepted(checkpoint(sessionId, mediaFileId, movie, command, 1, 860))
  await accepted(
    checkpoint(sessionId, mediaFileId, movie, command, 2, 910, 'playback'),
  )
  const ref = { profileId, titleId: movie.id }
  const watched = getTitleProgress(ref)
  expect(watched).toMatchObject({
    watchedAt: expect.any(Date),
    lastPlayedAt: expect.any(Date),
  })
  expect((await suggestions()).items).toEqual([])

  const removed = await app.inject({
    method: 'PUT',
    url: `/api/mine/v1/title/${movie.id}/seen`,
    cookies,
    payload: {
      expectedProfileId: profileId,
      language: 'en-US',
      season: 0,
      episode: 0,
      watched: false,
    },
  })
  expect(removed.statusCode, removed.body).toBe(200)
  expect(removed.json()).toMatchObject({ seen: { title: false } })
  expect(getTitleProgress(ref)).toMatchObject({
    position: 0,
    watchedAt: null,
    lastPlayedAt: watched?.lastPlayedAt,
  })
  expect(db.select().from(diaryEntries).all()).toHaveLength(1)
  expect(db.select().from(diarySeen).all()).toEqual([])
  expect((await suggestions()).items).toMatchObject([
    { card: { id: movie.id } },
  ])
})
