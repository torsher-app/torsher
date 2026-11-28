import type { CycleSource, TitleProgress } from '../../db/schema.ts'
import { afterSimklCompletion, enqueueSimklCompletion } from '../simkl/index.ts'
import type { ViewingCheckpoint, ViewingStart } from '../../dto/viewing.ts'
import type { PlayedVoice } from '../library/playedSource.ts'
import type { TitleRef } from '../sources/progress.ts'
import { createHash } from 'node:crypto'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  cyclePlaybackFacts,
  cycleProgress,
  diaryEntries,
  diarySeen,
  mineTitlePreferences,
  rewatchCycles,
  titleProgress,
  viewingAttempts,
  viewingBindings,
  viewingStartReceipts,
} from '../../db/schema.ts'
import { assertMaintenancePolicyChange } from '../libraryMaintenance/admission.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { isWatched } from '../torrents/playback.ts'
import { ensureDiaryTimeZone } from '../transfer/diaryTimeZone.ts'

type Attempt = typeof viewingAttempts.$inferSelect
type Binding = typeof viewingBindings.$inferSelect

export function exactViewingRef(ref: TitleRef) {
  const title = parseCatalogId(ref.titleId)
  if (title?.type === 'movie' && !ref.season && !ref.episode)
    return { ...ref, season: 0, episode: 0 }
  if (
    title?.type === 'tv'
    && ref.season !== undefined
    && ref.episode
    && ref.episode > 0
  ) {
    return { ...ref, season: ref.season, episode: ref.episode }
  }
}

type ExactViewingRef = NonNullable<ReturnType<typeof exactViewingRef>>

function attemptScope(ref: ExactViewingRef, cycleKey: string) {
  return and(
    eq(viewingAttempts.profileId, ref.profileId),
    eq(viewingAttempts.titleId, ref.titleId),
    eq(viewingAttempts.season, ref.season),
    eq(viewingAttempts.episode, ref.episode),
    eq(viewingAttempts.cycleKey, cycleKey),
  )
}

export function currentViewingAttempt(ref: ExactViewingRef, cycleKey = '') {
  return getDb()
    .select()
    .from(viewingAttempts)
    .where(attemptScope(ref, cycleKey))
    .orderBy(desc(viewingAttempts.generation))
    .get()
}

export function viewingAttemptWire(attempt: Attempt, current = true) {
  return {
    attemptId: attempt.id,
    generation: attempt.generation,
    state: attempt.state,
    current,
  }
}

export function cycleRevision(profileId: string, cycleId: string) {
  return getDb()
    .select({ revision: rewatchCycles.lifecycleRevision })
    .from(rewatchCycles)
    .where(
      and(
        eq(rewatchCycles.profileId, profileId),
        eq(rewatchCycles.id, cycleId),
        eq(rewatchCycles.state, 'active'),
      ),
    )
    .get()
    ?.revision
}

export function playableCycle(
  ref: ExactViewingRef,
  cycleId: string,
  revision?: number,
) {
  if (!ref.episode)
    return undefined
  return getDb()
    .select()
    .from(rewatchCycles)
    .where(
      and(
        eq(rewatchCycles.profileId, ref.profileId),
        eq(rewatchCycles.id, cycleId),
        eq(rewatchCycles.titleId, ref.titleId),
        eq(rewatchCycles.state, 'active'),
        revision === undefined
          ? undefined
          : eq(rewatchCycles.lifecycleRevision, revision),
      ),
    )
    .get()
}

export function getCycleCursor(ref: ExactViewingRef, cycleId: string) {
  return getDb()
    .select()
    .from(cycleProgress)
    .where(
      and(
        eq(cycleProgress.profileId, ref.profileId),
        eq(cycleProgress.cycleId, cycleId),
        eq(cycleProgress.season, ref.season),
        eq(cycleProgress.episode, ref.episode),
      ),
    )
    .get()
}

export function saveCycleCursor(
  ref: ExactViewingRef,
  cycleId: string,
  change: {
    source: CycleSource
    voice?: PlayedVoice
    position?: number
    duration?: number | null
    completedAt?: Date | null
  },
  now = new Date(),
) {
  const voice
    = change.voice === undefined
      ? {}
      : {
          voiceStudio: change.voice?.studio ?? null,
          voiceType: change.voice?.type ?? null,
        }
  const completed
    = change.completedAt === undefined ? {} : { completedAt: change.completedAt }
  const position
    = change.position === undefined
      ? {}
      : { position: change.position, duration: change.duration ?? null }
  const db = getDb()
  db.insert(cycleProgress)
    .values({
      profileId: ref.profileId,
      cycleId,
      season: ref.season,
      episode: ref.episode,
      position: 0,
      ...position,
      ...completed,
      source: change.source,
      ...voice,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        cycleProgress.profileId,
        cycleProgress.cycleId,
        cycleProgress.season,
        cycleProgress.episode,
      ],
      set: {
        ...position,
        ...completed,
        source: change.source,
        ...voice,
        updatedAt: sql`max(${cycleProgress.updatedAt}, ${now.getTime()})`,
      },
    })
    .run()
  if (change.position !== undefined) {
    db.update(rewatchCycles)
      .set({ updatedAt: now })
      .where(
        and(
          eq(rewatchCycles.profileId, ref.profileId),
          eq(rewatchCycles.id, cycleId),
          eq(rewatchCycles.targetSeason, ref.season),
          eq(rewatchCycles.targetEpisode, ref.episode),
        ),
      )
      .run()
  }
}

function completedLegacyPlayback(progress?: TitleProgress) {
  // Only an exact row last written as completed playback can seed a rewatch.
  return (
    !!progress?.watchedAt
    && progress.watchedAt.getTime() === progress.lastPlayedAt?.getTime()
    && progress.playedSource?.kind !== 'unknown'
    && progress.duration !== null
    && Number.isFinite(progress.duration)
    && progress.position > 0
    && progress.position <= progress.duration
    && isWatched(progress.position, progress.duration)
  )
}

function priorLegacyCompletion(ref: ExactViewingRef) {
  const progress = getDb()
    .select()
    .from(titleProgress)
    .where(viewingScope(titleProgress, ref, false))
    .get()
  return completedLegacyPlayback(progress)
}

/** Call only for an accepted legacy checkpoint in the progress transaction. */
export function rememberLegacyCompletion(progress: TitleProgress) {
  if (!progress.playedSource || !completedLegacyPlayback(progress))
    return
  const ref = exactViewingRef(progress)
  const attempt = ref && currentViewingAttempt(ref)
  if (attempt && !attempt.priorLegacyCompletion) {
    getDb()
      .update(viewingAttempts)
      .set({ priorLegacyCompletion: true })
      .where(eq(viewingAttempts.id, attempt.id))
      .run()
  }
}

/** Call within a synchronous transaction. Every successful request gets a durable receipt. */
export function beginViewing(
  ref: ExactViewingRef,
  start: ViewingStart,
  source: CycleSource,
  lifecycleRevision?: number,
) {
  const db = getDb()
  const cycleKey = start.cycleId ?? ''
  const command = createHash('sha256')
    .update(
      JSON.stringify([
        ref.titleId,
        ref.season,
        ref.episode,
        cycleKey,
        start.intent,
        start.expectedGeneration ?? null,
        source,
        ...(lifecycleRevision ? [lifecycleRevision] : []),
      ]),
    )
    .digest('hex')
  const receipt = db
    .select()
    .from(viewingStartReceipts)
    .where(
      and(
        eq(viewingStartReceipts.profileId, ref.profileId),
        eq(viewingStartReceipts.requestId, start.requestId),
      ),
    )
    .get()
  if (receipt) {
    if (receipt.command !== command)
      return undefined
    return db
      .select()
      .from(viewingAttempts)
      .where(eq(viewingAttempts.id, receipt.attemptId))
      .get()
  }

  let attempt = currentViewingAttempt(ref, cycleKey)
  if (
    start.expectedGeneration !== undefined
    && (attempt?.generation ?? 0) !== start.expectedGeneration
  ) {
    return undefined
  }
  if (start.intent === 'restart') {
    if (attempt?.state === 'open') {
      db.update(viewingAttempts)
        .set({ state: 'abandoned' })
        .where(eq(viewingAttempts.id, attempt.id))
        .run()
    }
  }
  if (!attempt || start.intent === 'restart') {
    attempt = db
      .insert(viewingAttempts)
      .values({
        profileId: ref.profileId,
        titleId: ref.titleId,
        season: ref.season,
        episode: ref.episode,
        cycleKey,
        generation: (attempt?.generation ?? 0) + 1,
        state: 'open',
        // Once playback starts, its own checkpoints can mark legacy progress watched.
        priorLegacyCompletion:
          !cycleKey
          && (attempt?.priorLegacyCompletion ?? priorLegacyCompletion(ref)),
        explicitRestart: !cycleKey && start.intent === 'restart',
      })
      .returning()
      .get()
  }

  db.insert(viewingStartReceipts)
    .values({
      profileId: ref.profileId,
      requestId: start.requestId,
      command,
      attemptId: attempt.id,
    })
    .run()
  const now = new Date()
  if (cycleKey) {
    if (start.intent === 'restart') {
      const cursor = getCycleCursor(ref, cycleKey)
      const updatedAt = new Date(
        Math.max(now.getTime(), (cursor?.updatedAt.getTime() ?? 0) + 1),
      )
      saveCycleCursor(
        ref,
        cycleKey,
        { position: 0, source, completedAt: null },
        updatedAt,
      )
    }
    db.update(rewatchCycles)
      .set({
        targetSeason: ref.season,
        targetEpisode: ref.episode,
        updatedAt: now,
      })
      .where(
        and(
          eq(rewatchCycles.profileId, ref.profileId),
          eq(rewatchCycles.id, cycleKey),
        ),
      )
      .run()
  }
  db.update(mineTitlePreferences)
    .set({ continuation: 'normal', updatedAt: now })
    .where(
      and(
        eq(mineTitlePreferences.profileId, ref.profileId),
        eq(mineTitlePreferences.titleId, ref.titleId),
        ne(mineTitlePreferences.continuation, 'normal'),
      ),
    )
    .run()
  ensureDiaryTimeZone()
  return attempt
}

export function bindViewing(
  sessionId: string,
  attempt: Attempt,
  start: ViewingStart,
  subject: string,
  sourceRevision: string,
  cycleLifecycleRevision?: number,
) {
  getDb()
    .insert(viewingBindings)
    .values({
      sessionId,
      attemptId: attempt.id,
      subject,
      clientId: start.clientId,
      playerId: start.playerId,
      sourceRevision,
      cycleLifecycleRevision,
    })
    .run()
}

export function liveViewingAttempt(sessionId: string) {
  const row = getDb()
    .select({
      attempt: viewingAttempts,
      cycleLifecycleRevision: viewingBindings.cycleLifecycleRevision,
    })
    .from(viewingBindings)
    .innerJoin(
      viewingAttempts,
      eq(viewingBindings.attemptId, viewingAttempts.id),
    )
    .where(eq(viewingBindings.sessionId, sessionId))
    .get()
  return (
    row && {
      ...row.attempt,
      cycleLifecycleRevision: row.cycleLifecycleRevision,
    }
  )
}

export function isCurrentViewing(attempt: Attempt, revision?: number | null) {
  return (
    attempt.state !== 'abandoned'
    && currentViewingAttempt(attempt, attempt.cycleKey)?.id === attempt.id
    && (!attempt.cycleKey
      || !!playableCycle(attempt, attempt.cycleKey, revision ?? 0))
  )
}

/** Must run before advancing any F-036 resource watermark. */
export function validateViewing(
  ref: ExactViewingRef,
  identity: Pick<
    Binding,
    'sessionId' | 'subject' | 'clientId' | 'playerId' | 'sourceRevision'
  >,
) {
  const row = getDb()
    .select({ binding: viewingBindings, attempt: viewingAttempts })
    .from(viewingBindings)
    .innerJoin(
      viewingAttempts,
      eq(viewingBindings.attemptId, viewingAttempts.id),
    )
    .where(eq(viewingBindings.sessionId, identity.sessionId))
    .get()
  if (!row)
    return undefined
  const { attempt, binding } = row
  return binding.subject === identity.subject
    && binding.playerId === identity.playerId
    && binding.clientId === identity.clientId
    && binding.sourceRevision === identity.sourceRevision
    && attempt.profileId === ref.profileId
    && attempt.titleId === ref.titleId
    && attempt.season === ref.season
    && attempt.episode === ref.episode
    && isCurrentViewing(attempt, binding.cycleLifecycleRevision)
    ? row
    : undefined
}

function viewingScope<
  T extends
  | typeof diarySeen
  | typeof cyclePlaybackFacts
  | typeof diaryEntries
  | typeof titleProgress,
>(table: T, ref: TitleRef, allEpisodes: boolean) {
  return and(
    eq(table.profileId, ref.profileId),
    eq(table.titleId, ref.titleId),
    allEpisodes
      ? undefined
      : and(
          eq(table.season, ref.season ?? 0),
          eq(table.episode, ref.episode ?? 0),
        ),
  )
}

/** Explicit unwatch leaves the diary and real activity timestamps in place. */
export function clearViewingSeen(ref: TitleRef, allEpisodes = false) {
  const db = getDb()
  db.delete(diarySeen)
    .where(viewingScope(diarySeen, ref, allEpisodes))
    .run()
  const scope = viewingScope(cyclePlaybackFacts, ref, allEpisodes)
  db.delete(cyclePlaybackFacts)
    .where(and(scope, sql`${cyclePlaybackFacts.lastPlayedAt} IS NULL`))
    .run()
  db.update(cyclePlaybackFacts)
    .set({ watchedAt: null, updatedAt: new Date() })
    .where(and(scope, sql`${cyclePlaybackFacts.watchedAt} IS NOT NULL`))
    .run()
}

/** Record one accepted event and return whether it confirmed real playback. */
export function applyViewingCheckpoint(
  viewing: { binding: Binding, attempt: Attempt },
  { kind, line }: ViewingCheckpoint,
  position: number,
  duration: number | null,
  now: Date,
) {
  const db = getDb()
  const { attempt, binding } = viewing
  const discontinuity = kind === 'seek' || kind === 'source_switch'
  const playback = kind === 'playback'
  // Only successive playback samples establish forward motion. In particular a
  // paused, stopped or newly attached player cannot use its first sample as proof.
  const previous = line === binding.line ? binding.baseline : null
  const forward = playback && previous !== null && position > previous
  const backwards = playback && previous !== null && position < previous
  const advanced
    = !discontinuity
      && !backwards
      && ((line === binding.line && binding.advanced) || forward)
  const baseline = discontinuity ? null : playback ? position : previous
  db.update(viewingBindings)
    .set({ line, baseline, advanced })
    .where(eq(viewingBindings.sessionId, binding.sessionId))
    .run()

  const completed
    = attempt.state === 'open'
      && advanced
      && (playback || kind === 'stop')
      && duration !== null
      && duration > 0
      && position <= duration
      && position >= duration * 0.9
  if (completed) {
    ensureDiaryTimeZone()
    const ref = {
      profileId: attempt.profileId,
      titleId: attempt.titleId,
      season: attempt.season,
      episode: attempt.episode,
    }
    const prior = db
      .select({ id: diaryEntries.id })
      .from(diaryEntries)
      .where(viewingScope(diaryEntries, ref, false))
      .get()
    const seen = db
      .select({ titleId: diarySeen.titleId })
      .from(diarySeen)
      .where(viewingScope(diarySeen, ref, false))
      .get()
    const diary = db.insert(diaryEntries)
      .values({
        ...ref,
        precision: 'instant',
        instant: now,
        origin: 'playback',
        originKey: attempt.id,
        context: attempt.cycleKey
          ? { kind: 'cycle', cycleId: attempt.cycleKey }
          : { kind: 'normal' },
        rewatch:
          !!attempt.cycleKey
          || !!prior
          || !!seen
          || (attempt.explicitRestart && attempt.priorLegacyCompletion),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: diaryEntries.id })
      .get()
    enqueueSimklCompletion(ref, attempt.id, diary.id, now.getTime())
    afterSimklCompletion(ref.profileId, diary.id)
    db.insert(diarySeen)
      .values(ref)
      .onConflictDoUpdate({
        target: [
          diarySeen.profileId,
          diarySeen.titleId,
          diarySeen.season,
          diarySeen.episode,
        ],
        // A fresh, accepted completion protects this seen from an earlier import undo.
        set: { episode: ref.episode },
      })
      .run()
    db.update(viewingAttempts)
      .set({ state: 'completed' })
      .where(eq(viewingAttempts.id, attempt.id))
      .run()
  }

  if (forward) {
    db.update(mineTitlePreferences)
      .set({ continuation: 'normal', updatedAt: now })
      .where(
        and(
          eq(mineTitlePreferences.profileId, attempt.profileId),
          eq(mineTitlePreferences.titleId, attempt.titleId),
          ne(mineTitlePreferences.continuation, 'normal'),
        ),
      )
      .run()
  }

  if (attempt.cycleKey && (forward || completed)) {
    assertMaintenancePolicyChange({ titleId: attempt.titleId })
    const watched = completed ? { watchedAt: now } : {}
    db.insert(cyclePlaybackFacts)
      .values({
        profileId: attempt.profileId,
        titleId: attempt.titleId,
        season: attempt.season,
        episode: attempt.episode,
        ...watched,
        lastPlayedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          cyclePlaybackFacts.profileId,
          cyclePlaybackFacts.titleId,
          cyclePlaybackFacts.season,
          cyclePlaybackFacts.episode,
        ],
        set: { ...watched, lastPlayedAt: now, updatedAt: now },
      })
      .run()
  }
  return completed
}
