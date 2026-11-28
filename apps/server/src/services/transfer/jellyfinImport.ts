import type { ImportSummary } from '../../db/schema.ts'
import type { JellyfinPreview, JellyfinPreviewBody } from '../../dto/jellyfinImport.ts'
import type { JellyfinItem, JellyfinSource, JellyfinTarget } from './jellyfinSource.ts'
import type { PersonalRows } from './personalSpace.ts'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { diarySeen, profileImports } from '../../db/schema.ts'
import { abortable } from '../net/trustedHttp.ts'
import { allowedTitleIds, titleAllowedCached } from '../profiles/access.ts'
import { getProfile } from '../profiles/index.ts'
import { getTitleSummary, tmdbEpisodeExists } from '../tmdb/index.ts'
import { TmdbError } from '../tmdb/client.ts'
import { findByExternalId } from '../tmdb/find.ts'
import { parseCatalogId, toCatalogId } from '../tmdb/mappers.ts'
import {
  JellyfinImportError,
  readJellyfinSource,
  resolveJellyfinTarget,
} from './jellyfinSource.ts'
import { planPersonalMerge } from './personalSpace.ts'
import { UndoJournalBuilder } from './undoJournal.ts'

const CONNECTION_TTL = 5 * 60_000
const JOB_DEADLINE = 10 * 60_000
const PREVIEW_TTL = 30 * 60_000
const LANGUAGE = 'en-US'
const MATCH_CONCURRENCY = 4

interface Connection {
  id: string
  ownerId: string
  target: JellyfinTarget
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

type Seen = Omit<PersonalRows['seen'][number], 'profile'>
type Counts = NonNullable<JellyfinPreview['movies']>
type Skips = NonNullable<JellyfinPreview['skipped']>
interface Matched { item: JellyfinItem, row?: Seen, skip?: 'invalid' | 'unmatched' }

interface Prepared {
  ageLimit: number | null
  sourceKey: string
  seen: Seen[]
  existing: Set<string>
  movies: Counts
  episodes: Counts
}

interface Job {
  id: string
  ownerId: string
  profileId: string
  abort: AbortController
  timer: ReturnType<typeof setTimeout>
  expiresAt: number
  preview: JellyfinPreview
  prepared?: Prepared
}

const connections = new Map<string, Connection>()
const jobs = new Map<string, Job>()
const resolving = new Map<string, symbol>()

function forgetConnection(profileId: string) {
  const connection = connections.get(profileId)
  if (connection)
    clearTimeout(connection.timer)
  connections.delete(profileId)
}

function forgetJob(profileId: string) {
  const job = jobs.get(profileId)
  if (job) {
    clearTimeout(job.timer)
    job.abort.abort()
  }
  jobs.delete(profileId)
}

export function cancelJellyfinProfileImports(profileId: string) {
  resolving.delete(profileId)
  forgetConnection(profileId)
  forgetJob(profileId)
}

export function stopJellyfinImports() {
  for (const id of connections.keys()) forgetConnection(id)
  for (const id of jobs.keys()) forgetJob(id)
  resolving.clear()
}

function requireProfile(id: string) {
  const profile = getProfile(id)
  if (!profile)
    throw new JellyfinImportError('expired')
  return profile
}

export async function jellyfinConnection(ownerId: string, profileId: string, input: string) {
  requireProfile(profileId)
  if (resolving.has(profileId) || jobs.get(profileId)?.preview.state === 'reading')
    throw new JellyfinImportError('busy')

  const attempt = Symbol('Jellyfin address check')
  resolving.set(profileId, attempt)
  forgetConnection(profileId)
  try {
    const target = await resolveJellyfinTarget(input)
    requireProfile(profileId)
    if (resolving.get(profileId) !== attempt)
      throw new JellyfinImportError('expired')
    const id = randomUUID()
    const expiresAt = Date.now() + CONNECTION_TTL
    connections.set(profileId, {
      id,
      ownerId,
      target,
      expiresAt,
      timer: setTimeout(forgetConnection, CONNECTION_TTL, profileId).unref(),
    })
    return {
      id,
      address: target.base.href,
      addresses: target.addresses,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }
  finally {
    if (resolving.get(profileId) === attempt)
      resolving.delete(profileId)
  }
}

function viewingKey({ title, season, episode }: Seen) {
  return `${title}:${season}:${episode}`
}

function currentSeen(profileId: string) {
  return new Set(getDb().select({
    title: diarySeen.titleId,
    season: diarySeen.season,
    episode: diarySeen.episode,
  }).from(diarySeen).where(eq(diarySeen.profileId, profileId)).all().map(viewingKey))
}

function matching(signal: AbortSignal) {
  const titles = new Map<string, Promise<string | undefined>>()
  const episodes = new Map<string, Promise<boolean>>()

  function cache<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
    let value = map.get(key)
    if (!value) {
      value = abortable(load(), signal)
      map.set(key, value)
    }
    return value
  }

  async function lookup(item: JellyfinItem, ids: NonNullable<JellyfinItem['ids']>) {
    const kind = item.kind === 'movie' ? 'movie' : 'series'
    const direct = ids.tmdb ? toCatalogId(kind === 'movie' ? 'movie' : 'tv', ids.tmdb) : undefined
    const external = ids.imdb ? await findByExternalId(ids.imdb, 'imdb_id', kind, true) : undefined
    if (ids.imdb && (!external || (direct && external !== direct)))
      return undefined
    const title = direct ?? external
    if (!title)
      return undefined

    const summary = await getTitleSummary(title, LANGUAGE, { requireFresh: true, signal })
    if (!summary || summary.details.id !== title
      || (ids.imdb && summary.imdbId && summary.imdbId !== ids.imdb)) {
      return undefined
    }
    return title
  }

  return async (item: JellyfinItem): Promise<Matched> => {
    signal.throwIfAborted()
    if (!item.ids)
      return { item, skip: 'invalid' }
    try {
      const { tmdb, imdb } = item.ids
      const title = await cache(titles, JSON.stringify([item.kind, tmdb, imdb]), () => lookup(item, { tmdb, imdb }))
      if (title) {
        const row = { title, season: item.season, episode: item.episode }
        if (item.kind === 'movie' || await cache(episodes, JSON.stringify([viewingKey(row), item.episodeTmdbId]), () =>
          tmdbEpisodeExists(parseCatalogId(title)!.tmdbId, item.season, item.episode, LANGUAGE, item.episodeTmdbId))) {
          return { item, row }
        }
      }
      return { item, skip: 'unmatched' }
    }
    catch (error) {
      if (error instanceof TmdbError && error.kind === 'not_found')
        return { item, skip: 'unmatched' }
      throw new JellyfinImportError('catalog')
    }
  }
}

function counts(): Counts {
  return { added: 0, existing: 0, skipped: 0 }
}

async function prepare(job: Job, source: JellyfinSource) {
  const signal = job.abort.signal
  signal.throwIfAborted()
  const ageLimit = requireProfile(job.profileId).ageLimit
  const match = matching(signal)
  const items: Matched[] = []
  for (let index = 0; index < source.items.length; index += MATCH_CONCURRENCY)
    items.push(...await Promise.all(source.items.slice(index, index + MATCH_CONCURRENCY).map(match)))

  const candidates = [...new Set(items.flatMap(item => item.row ? [item.row.title] : []))]
  const allowed = new Set<string>()
  // Keep cancellation from leaving a 20k-item backlog in the shared age queue.
  for (let index = 0; index < candidates.length; index += 24) {
    signal.throwIfAborted()
    for (const id of await abortable(allowedTitleIds(job.profileId, candidates.slice(index, index + 24)), signal))
      allowed.add(id)
  }
  signal.throwIfAborted()
  if (requireProfile(job.profileId).ageLimit !== ageLimit)
    throw new JellyfinImportError('profileChanged')
  const current = currentSeen(job.profileId)
  const grouped = { movie: counts(), episode: counts() }
  const skipped: Skips = { invalid: 0, unmatched: 0, restricted: 0, duplicate: 0 }
  const seen: Seen[] = []
  const existing = new Set<string>()
  const distinct = new Set<string>()
  let lastActivityAt: string | undefined
  for (const { item, row, skip } of items) {
    const count = grouped[item.kind]
    if (!row) {
      skipped[skip ?? 'invalid']++
      count.skipped++
      continue
    }
    if (!allowed.has(row.title) || !titleAllowedCached(job.profileId, row.title)) {
      skipped.restricted++
      count.skipped++
      continue
    }
    const key = viewingKey(row)
    const time = item.lastActivityAt
    if (time && (!lastActivityAt || time > lastActivityAt))
      lastActivityAt = time
    if (distinct.has(key)) {
      skipped.duplicate++
      count.skipped++
      continue
    }
    distinct.add(key)
    seen.push(row)
    if (current.has(key)) {
      existing.add(key)
      count.existing++
    }
    else {
      count.added++
    }
  }

  const sourceKey = `jellyfin:${createHash('sha256').update(JSON.stringify([source.serverId, source.userId])).digest('hex')}`
  job.prepared = {
    ageLimit,
    sourceKey,
    seen,
    existing,
    movies: grouped.movie,
    episodes: grouped.episode,
  }
  job.preview = {
    id: job.id,
    state: 'ready',
    source: { server: source.server, user: source.user },
    movies: grouped.movie,
    episodes: grouped.episode,
    skipped,
    lastActivityAt,
    logoutWarning: source.logoutWarning,
  }
}

export function startJellyfinPreview(ownerId: string, profileId: string, input: JellyfinPreviewBody) {
  requireProfile(profileId)
  if (jobs.get(profileId)?.preview.state === 'reading' || resolving.has(profileId))
    throw new JellyfinImportError('busy')

  const connection = connections.get(profileId)
  if (!connection || connection.ownerId !== ownerId || connection.id !== input.connectionId || connection.expiresAt <= Date.now())
    throw new JellyfinImportError('expired')

  forgetConnection(profileId)
  forgetJob(profileId)

  const id = randomUUID()
  const abort = new AbortController()
  const job: Job = {
    id,
    ownerId,
    profileId,
    abort,
    timer: setTimeout(() => abort.abort(), JOB_DEADLINE).unref(),
    expiresAt: Date.now() + JOB_DEADLINE,
    preview: { id, state: 'reading' },
  }
  jobs.set(profileId, job)

  void readJellyfinSource(connection.target, { username: input.username, password: input.password }, abort.signal)
    .then(async (source) => {
      job.preview.logoutWarning = source.logoutWarning
      if (jobs.get(profileId) === job)
        await prepare(job, source)
    })
    .catch((error: unknown) => {
      job.preview = {
        id,
        state: 'failed',
        error: error instanceof JellyfinImportError ? error.kind : 'response',
        logoutWarning: job.preview.logoutWarning || (error instanceof JellyfinImportError && error.logoutWarning),
      }
    })
    .finally(() => {
      if (jobs.get(profileId) !== job)
        return
      clearTimeout(job.timer)
      job.expiresAt = Date.now() + PREVIEW_TTL
      job.timer = setTimeout(forgetJob, PREVIEW_TTL, profileId).unref()
    })
  return { id }
}

function getJob(ownerId: string, profileId: string, id: string) {
  requireProfile(profileId)
  const job = jobs.get(profileId)
  if (!job || job.ownerId !== ownerId || job.id !== id || job.expiresAt <= Date.now())
    throw new JellyfinImportError('expired')
  return job
}

export function jellyfinPreview(ownerId: string, profileId: string, id: string) {
  return getJob(ownerId, profileId, id).preview
}

export function cancelJellyfinPreview(ownerId: string, profileId: string, id: string) {
  getJob(ownerId, profileId, id)
  forgetJob(profileId)
}

export function applyJellyfinPreview(ownerId: string, profileId: string, id: string) {
  const db = getDb()
  const result = db.transaction((tx) => {
    const profile = requireProfile(profileId)
    const completed = tx.select().from(profileImports).where(and(
      eq(profileImports.profileId, profileId),
      eq(profileImports.id, id),
    )).get()
    if (completed?.sources.startsWith('jellyfin:'))
      return { id, ...completed.summary }

    const job = getJob(ownerId, profileId, id)
    const prepared = job.prepared
    if (!prepared)
      throw new JellyfinImportError(job.preview.error ?? 'busy')
    const current = currentSeen(profileId)
    if (profile.ageLimit !== prepared.ageLimit || prepared.seen.some((row) => {
      const key = viewingKey(row)
      return current.has(key) !== prepared.existing.has(key) || !titleAllowedCached(profileId, row.title)
    })) {
      throw new JellyfinImportError('profileChanged')
    }

    const plan = planPersonalMerge(profileId, {
      seen: prepared.seen.map(row => ({ ...row, profile: profileId })),
      diary: [],
      cycles: [],
      cycleProgress: [],
      cyclePlayback: [],
      titlePreferences: [],
      profilePreferences: [],
    }, 'external')
    const journal = new UndoJournalBuilder(profileId)
    for (const write of plan.writes)
      write(profileId, journal)
    const undo = journal.finish()
    const changedTitles = new Set(undo.groups.map(group => group.titleId))
    const unchangedTitles = [...plan.unchangedTitles].filter(title => !changedTitles.has(title))
    const summary: ImportSummary = {
      imported: changedTitles.size,
      unchanged: unchangedTitles.length,
      unmatched: 0,
      history: { ...plan.history!, skipped: prepared.movies.skipped + prepared.episodes.skipped },
    }
    tx.insert(profileImports).values({
      id,
      profileId,
      sources: prepared.sourceKey,
      conflicts: 'keep',
      summary,
      undo,
      appliedAt: new Date(),
    }).run()
    return { id, ...summary }
  })
  if (jobs.get(profileId)?.id === id)
    forgetJob(profileId)
  return result
}
