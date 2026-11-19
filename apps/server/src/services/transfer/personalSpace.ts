import type { ProfileMoveConflict } from '../../dto/profiles.ts'
import type { ExportDocument, ExportPersonalSpace } from './document.ts'
import type { UndoJournalBuilder } from './undoJournal.ts'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  cyclePlaybackFacts,
  cycleProgress,
  diaryEntries,
  diarySeen,
  mineProfilePreferences,
  mineTitlePreferences,
  rewatchCycles,
} from '../../db/schema.ts'

import { visibleCollectionRef } from '../collections/index.ts'

export type PersonalRows = Omit<ExportPersonalSpace, 'timeZone'>

export function personalRowsOf(
  document: ExportDocument,
  profile: string,
): PersonalRows | undefined {
  if (document.version === 1)
    return undefined

  const space = document.personalSpace
  return {
    diary: space.diary.filter(row => row.profile === profile),
    seen: space.seen.filter(row => row.profile === profile),
    cycles: space.cycles.filter(row => row.profile === profile),
    cycleProgress: space.cycleProgress.filter(row => row.profile === profile),
    cyclePlayback: space.cyclePlayback.filter(row => row.profile === profile),
    titlePreferences: space.titlePreferences.filter(
      row => row.profile === profile,
    ),
    profilePreferences: space.profilePreferences.filter(
      row => row.profile === profile,
    ),
  }
}

function iso(date: Date | null) {
  return date?.toISOString() ?? null
}

export function exportPersonalRows(
  ids: string[],
  keys: Map<string, string>,
): PersonalRows {
  const db = getDb()
  const profile = (id: string) => keys.get(id)!
  return {
    diary: db
      .select()
      .from(diaryEntries)
      .where(inArray(diaryEntries.profileId, ids))
      .all()
      .map(row => ({
        profile: profile(row.profileId),
        title: row.titleId,
        id: row.id,
        season: row.season,
        episode: row.episode,
        precision: row.precision,
        instant: iso(row.instant),
        day: row.day,
        origin: row.origin,
        originKey: row.originKey,
        sourceMatchKey: row.sourceMatchKey ?? undefined,
        rewatch: row.rewatch,
        note: row.note,
        viewingContext: row.viewingContext,
        context: row.context,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    seen: db
      .select()
      .from(diarySeen)
      .where(inArray(diarySeen.profileId, ids))
      .all()
      .map(row => ({
        profile: profile(row.profileId),
        title: row.titleId,
        season: row.season,
        episode: row.episode,
      })),
    cycles: db
      .select()
      .from(rewatchCycles)
      .where(inArray(rewatchCycles.profileId, ids))
      .all()
      .map(row => ({
        profile: profile(row.profileId),
        title: row.titleId,
        id: row.id,
        startSeason: row.startSeason,
        startEpisode: row.startEpisode,
        targetSeason: row.targetSeason,
        targetEpisode: row.targetEpisode,
        state: row.state,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    cycleProgress: db
      .select()
      .from(cycleProgress)
      .where(inArray(cycleProgress.profileId, ids))
      .all()
      .map(row => ({
        profile: profile(row.profileId),
        cycleId: row.cycleId,
        season: row.season,
        episode: row.episode,
        position: row.position,
        duration: row.duration,
        source: row.source,
        voiceStudio: row.voiceStudio,
        voiceType: row.voiceType,
        completedAt: iso(row.completedAt),
        updatedAt: row.updatedAt.toISOString(),
      })),
    cyclePlayback: db
      .select()
      .from(cyclePlaybackFacts)
      .where(inArray(cyclePlaybackFacts.profileId, ids))
      .all()
      .map(row => ({
        profile: profile(row.profileId),
        title: row.titleId,
        season: row.season,
        episode: row.episode,
        watchedAt: iso(row.watchedAt),
        lastPlayedAt: iso(row.lastPlayedAt),
        updatedAt: row.updatedAt.toISOString(),
      })),
    titlePreferences: db
      .select()
      .from(mineTitlePreferences)
      .where(inArray(mineTitlePreferences.profileId, ids))
      .all()
      .map(row => ({
        profile: profile(row.profileId),
        title: row.titleId,
        note: row.note,
        continuation: row.continuation,
        notInterested: row.notInterested,
        updatedAt: row.updatedAt.toISOString(),
      })),
    profilePreferences: db
      .select()
      .from(mineProfilePreferences)
      .where(inArray(mineProfilePreferences.profileId, ids))
      .all()
      .map(row => ({
        profile: profile(row.profileId),
        startSection: row.startSection,
        startCollectionName: row.startCollectionId
          ? (visibleCollectionRef(row.profileId, { id: row.startCollectionId })
              ?.name ?? null)
          : null,
        updatedAt: row.updatedAt.toISOString(),
      })),
  }
}

type PersonalWrite = (profileId: string, journal?: UndoJournalBuilder) => void

export interface HistoryImportCounts {
  // Counts of real diary entries. The seen projection has its own counters.
  new: number
  same: number
  seen: { new: number, same: number }
  skipped: number
}

type PersonalMergeMode = 'native' | 'move' | 'external' | 'external-confirmed'

export interface PersonalMergePlan {
  writes: PersonalWrite[]
  unchanged: number
  unchangedTitles: Set<string>
  skipped: number
  history?: HistoryImportCounts
}

function keysOf(row: { title: string, season: number, episode: number }) {
  return [row.title, row.season, row.episode] as const
}

function documentKey(values: readonly (string | number)[]) {
  return JSON.stringify(values)
}

function viewingKey(row: { title: string, season: number, episode: number }) {
  return documentKey(keysOf(row))
}

function originKey(row: PersonalRows['diary'][number]) {
  return row.originKey === null
    ? []
    : [documentKey([row.origin, row.originKey])]
}

function cursorKeys(row: PersonalRows['cycleProgress'][number]) {
  return [row.cycleId, row.season, row.episode]
}

function newest(
  current: { updatedAt: string } | undefined,
  incoming: { updatedAt: string },
) {
  return (
    !current || Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt)
  )
}

type Cycle = PersonalRows['cycles'][number]

function sameCycle(a: Cycle, b: Cycle) {
  return (
    a.title === b.title
    && a.startSeason === b.startSeason
    && a.startEpisode === b.startEpisode
  )
}

function remappedCycleId(id: string, title: string) {
  // RFC 9562 version 8. Detached diary contexts know the original ID and
  // title, so they must get the same alternate ID as the complete cycle.
  const hex = createHash('sha256')
    .update(documentKey(['rewatchCycle', id, title]))
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function cycleContextIds(rows: PersonalRows['diary']) {
  const titles = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.context?.kind !== 'cycle')
      continue
    const id = row.context.cycleId
    const used = titles.get(id) ?? new Set<string>()
    used.add(row.title)
    titles.set(id, used)
  }
  return titles
}

function cycleIdentities(
  rows: PersonalRows,
  current: PersonalRows | undefined,
) {
  const occupied = new Map(
    (current?.cycles ?? []).map(row => [row.id, row.title]),
  )
  const contextIds = cycleContextIds(current?.diary ?? [])
  const incomingIds = new Set([
    ...rows.cycles.map(row => row.id),
    ...cycleContextIds(rows.diary).keys(),
  ])
  const assigned = new Map<string, string>()

  return (original: string, title: string) => {
    const alternate = remappedCycleId(original, title)
    const identity = documentKey([original, title])
    const available = (id: string) => {
      const owner = occupied.get(id)
      const titles = contextIds.get(id)
      const claim = assigned.get(id)
      return (
        (!owner || owner === title)
        && (!titles || (titles.size === 1 && titles.has(title)))
        && (!claim || claim === identity)
      )
    }

    // Keep a previously remapped association even if the original slot
    // later becomes free. A detached context is enough to identify it.
    const alternateAvailable
      = !incomingIds.has(alternate) && available(alternate)
    const knownAlternate
      = alternateAvailable
        && (occupied.has(alternate) || contextIds.has(alternate))
    const resolved = knownAlternate
      ? alternate
      : available(original)
        ? original
        : alternateAvailable
          ? alternate
          : undefined
    if (resolved)
      assigned.set(resolved, identity)
    return resolved
  }
}

export class PersonalSpaceMoveConflictError extends Error {
  readonly reason: ProfileMoveConflict['reason']

  constructor(reason: ProfileMoveConflict['reason']) {
    super('personalMoveConflict')
    this.name = 'PersonalSpaceMoveConflictError'
    this.reason = reason
  }
}

function planCycles(
  rows: PersonalRows,
  current: PersonalRows | undefined,
  plan: PersonalMergePlan,
  resolveCycleId: ReturnType<typeof cycleIdentities>,
  move: boolean,
) {
  const local = new Map((current?.cycles ?? []).map(row => [row.id, row]))
  const unfinished = new Map(
    (current?.cycles ?? [])
      .filter(row => row.state !== 'ended')
      .map(row => [row.title, row.id]),
  )
  const accepted = new Map<string, { id: string, title: string } | null>()

  // Ending one cycle can make room for another from this same file.
  const sorted = [...rows.cycles].sort(
    (a, b) => Number(b.state === 'ended') - Number(a.state === 'ended'),
  )
  for (const incoming of sorted) {
    const title = incoming.title
    const id = resolveCycleId(incoming.id, title)
    const previous = id === undefined ? undefined : local.get(id)
    if (!id || (previous && !sameCycle(previous, incoming))) {
      // Same-title conflicts on the immutable start cannot be disambiguated
      // by later snapshots that include only a diary context.
      if (move)
        throw new PersonalSpaceMoveConflictError('cycleIdentity')
      accepted.set(incoming.id, null)
      plan.skipped++
      continue
    }
    const group = documentKey(['cycles', title])
    accepted.set(incoming.id, { id, title })
    if (!newest(previous, incoming)) {
      plan.unchanged++
      plan.unchangedTitles.add(title)
      continue
    }

    const active = unfinished.get(title)
    let state = incoming.state
    if (state !== 'ended' && active && active !== id) {
      // Keep the local active cycle. Preserve the incoming cycle and its
      // positions as ended, and report the state conflict in the preview.
      state = 'ended'
      plan.skipped++
    }
    if (state !== 'ended')
      unfinished.set(title, id)
    else if (active === id)
      unfinished.delete(title)

    plan.writes.push((profileId, journal) => {
      journal?.record('cycle', [id], title, { group })
      const data = {
        targetSeason: incoming.targetSeason,
        targetEpisode: incoming.targetEpisode,
        state,
        updatedAt: new Date(incoming.updatedAt),
      }
      getDb()
        .insert(rewatchCycles)
        .values({
          ...data,
          profileId,
          titleId: title,
          id,
          startSeason: incoming.startSeason,
          startEpisode: incoming.startEpisode,
          createdAt: new Date(incoming.createdAt),
        })
        .onConflictDoUpdate({
          target: [rewatchCycles.profileId, rewatchCycles.id],
          set: data,
        })
        .run()
    })
  }

  const cursors = new Map(
    (current?.cycleProgress ?? []).map(row => [
      documentKey(cursorKeys(row)),
      row,
    ]),
  )
  for (const incoming of rows.cycleProgress) {
    const cycle = accepted.get(incoming.cycleId)
    if (!cycle) {
      plan.skipped++
      continue
    }

    const key = [cycle.id, incoming.season, incoming.episode]
    const previous = cursors.get(documentKey(key))
    if (!newest(previous, incoming)) {
      plan.unchanged++
      plan.unchangedTitles.add(cycle.title)
      continue
    }

    // Older documents can omit completion. A newer explicit null is a restart.
    const completedAt
      = incoming.completedAt === undefined
        ? previous?.completedAt
        : incoming.completedAt
    const group = documentKey(['cycles', cycle.title])
    plan.writes.push((profileId, journal) => {
      journal?.record('cycle', [cycle.id], cycle.title, {
        group,
        changed: false,
      })
      journal?.record('cycleProgress', key, cycle.title, { group })
      const data = {
        position: incoming.position,
        duration: incoming.duration,
        source: incoming.source,
        voiceStudio: incoming.voiceStudio,
        voiceType: incoming.voiceType,
        completedAt: completedAt ? new Date(completedAt) : null,
        updatedAt: new Date(incoming.updatedAt),
      }
      getDb()
        .insert(cycleProgress)
        .values({
          ...data,
          profileId,
          cycleId: cycle.id,
          season: incoming.season,
          episode: incoming.episode,
        })
        .onConflictDoUpdate({
          target: [
            cycleProgress.profileId,
            cycleProgress.cycleId,
            cycleProgress.season,
            cycleProgress.episode,
          ],
          set: data,
        })
        .run()
    })
  }

  return accepted
}

function planDiary(
  rows: PersonalRows,
  current: PersonalRows | undefined,
  cycles: ReturnType<typeof planCycles>,
  resolveCycleId: ReturnType<typeof cycleIdentities>,
  plan: PersonalMergePlan,
  mode: PersonalMergeMode,
) {
  const move = mode === 'move'
  const confirmed = mode === 'external-confirmed'
  const external = mode === 'external' || confirmed
  const counts = plan.history
  const seenInputs = new Map(rows.seen.map(row => [viewingKey(row), row]))
  const byId = new Map((current?.diary ?? []).map(row => [row.id, row]))
  const byOrigin = new Map(
    (current?.diary ?? []).flatMap(row =>
      originKey(row).map(key => [key, row] as const),
    ),
  )
  const seen = new Set((current?.seen ?? []).map(viewingKey))
  const seenTouched = new Set<string>()
  const unchangedEntries = new Map<string, string[]>()

  function takeSeenTouch(group: string, target: PersonalRows['seen'][number]) {
    if (!seen.has(group) || seenTouched.has(group))
      return undefined
    seenTouched.add(group)
    return (profileId: string) => {
      getDb()
        .update(diarySeen)
        .set({ episode: target.episode })
        .where(
          and(
            eq(diarySeen.profileId, profileId),
            eq(diarySeen.titleId, target.title),
            eq(diarySeen.season, target.season),
            eq(diarySeen.episode, target.episode),
          ),
        )
        .run()
    }
  }

  function recordDiaryChange(
    journal: UndoJournalBuilder | undefined,
    incoming: PersonalRows['diary'][number],
    id: string,
    group: string,
  ) {
    if (!journal)
      return
    journal.record('seen', [...keysOf(incoming)], incoming.title, {
      group,
      changed: false,
    })
    journal.record('diary', [id], incoming.title, { group })
    for (const witness of unchangedEntries.get(group) ?? []) {
      journal.record('diary', [witness], incoming.title, {
        group,
        changed: false,
      })
    }
  }

  for (const incoming of rows.diary) {
    const key = originKey(incoming)[0]
    const sameOrigin = key === undefined ? undefined : byOrigin.get(key)
    const sameId = byId.get(incoming.id)
    const previous = sameOrigin ?? sameId
    const group = viewingKey(incoming)
    const collision
      = previous
        && (viewingKey(previous) !== group
          || previous.origin !== incoming.origin
          || previous.originKey !== incoming.originKey)
    if (collision && sameOrigin && move) {
      throw new PersonalSpaceMoveConflictError(
        previous.title === incoming.title ? 'originEpisode' : 'originTitle',
      )
    }
    if (collision && !move) {
      plan.skipped++
      continue
    }
    let context = incoming.context
    if (context?.kind === 'cycle') {
      const cycle = cycles.get(context.cycleId)
      const resolved
        = cycle === undefined
          ? resolveCycleId(context.cycleId, incoming.title)
          : cycle?.id
      if (!resolved) {
        if (move)
          throw new PersonalSpaceMoveConflictError('cycleIdentity')
        plan.skipped++
        continue
      }
      context = { kind: 'cycle', cycleId: resolved }
    }

    if (previous && !collision && (external || !newest(previous, incoming))) {
      const missingProof
        = !external && sameOrigin && !previous.sourceMatchKey
          ? incoming.sourceMatchKey
          : undefined
      if (missingProof) {
        // A v2 round trip may know how an older import was matched even
        // when its diary fields are fresher on this installation.
        plan.writes.push((profileId, journal) => {
          recordDiaryChange(journal, incoming, previous.id, group)
          getDb()
            .update(diaryEntries)
            .set({ sourceMatchKey: missingProof })
            .where(
              and(
                eq(diaryEntries.profileId, profileId),
                eq(diaryEntries.id, previous.id),
              ),
            )
            .run()
        })
        continue
      }

      const unchanged = unchangedEntries.get(group) ?? []
      unchanged.push(previous.id)
      unchangedEntries.set(group, unchanged)
      plan.unchanged++
      plan.unchangedTitles.add(incoming.title)
      if (counts) {
        counts.same++
        if (seen.has(group) && !seenInputs.has(group))
          seenInputs.set(group, incoming)
      }
      if (confirmed) {
        const touchSeen = takeSeenTouch(group, incoming)
        plan.writes.push((profileId) => {
          // Manual resolution confirms an already imported fact as a new
          // user action. Preserve its date and notes, but fence earlier undo.
          getDb()
            .update(diaryEntries)
            .set({
              sourceMatchKey:
                incoming.sourceMatchKey ?? previous.sourceMatchKey ?? null,
            })
            .where(
              and(
                eq(diaryEntries.profileId, profileId),
                eq(diaryEntries.id, previous.id),
              ),
            )
            .run()
          touchSeen?.(profileId)
        })
      }
      continue
    }

    if (counts) {
      counts.new++
      if (!seenInputs.has(group))
        seenInputs.set(group, incoming)
    }

    const id = collision ? randomUUID() : (previous?.id ?? incoming.id)
    const title = incoming.title
    const touchSeen = takeSeenTouch(group, incoming)
    plan.writes.push((profileId, journal) => {
      recordDiaryChange(journal, incoming, id, group)
      // An earlier batch can own this mark. Claim a new version without
      // changing its value when a new viewing now relies on it.
      touchSeen?.(profileId)
      const data = {
        precision: incoming.precision,
        instant: incoming.instant ? new Date(incoming.instant) : null,
        day: incoming.day,
        rewatch: incoming.rewatch,
        note: incoming.note,
        sourceMatchKey:
          (collision ? undefined : sameOrigin?.sourceMatchKey)
          ?? incoming.sourceMatchKey
          ?? null,
        viewingContext: incoming.viewingContext,
        context,
        updatedAt: new Date(incoming.updatedAt),
      }
      getDb()
        .insert(diaryEntries)
        .values({
          ...data,
          profileId,
          id,
          titleId: title,
          season: incoming.season,
          episode: incoming.episode,
          origin: incoming.origin,
          originKey: incoming.originKey,
          createdAt: new Date(incoming.createdAt),
        })
        .onConflictDoUpdate({
          target: [diaryEntries.profileId, diaryEntries.id],
          set: data,
        })
        .run()
    })
  }

  for (const [group, incoming] of seenInputs) {
    if (seen.has(group)) {
      plan.unchanged++
      plan.unchangedTitles.add(incoming.title)
      if (counts)
        counts.seen.same++
      if (confirmed) {
        const touchSeen = takeSeenTouch(group, incoming)
        if (touchSeen)
          plan.writes.push(touchSeen)
      }
      continue
    }

    if (counts)
      counts.seen.new++
    plan.writes.push((profileId, journal) => {
      journal?.record('seen', [...keysOf(incoming)], incoming.title, { group })
      for (const id of unchangedEntries.get(group) ?? []) {
        journal?.record('diary', [id], incoming.title, {
          group,
          changed: false,
        })
      }
      getDb()
        .insert(diarySeen)
        .values({
          profileId,
          titleId: incoming.title,
          season: incoming.season,
          episode: incoming.episode,
        })
        .run()
    })
  }
}

export function planPersonalMerge(
  targetId: string | null,
  rows: PersonalRows,
  mode: PersonalMergeMode = 'native',
): PersonalMergePlan {
  const plan: PersonalMergePlan = {
    writes: [],
    unchanged: 0,
    unchangedTitles: new Set(),
    skipped: 0,
  }
  if (mode === 'external' || mode === 'external-confirmed')
    plan.history = { new: 0, same: 0, seen: { new: 0, same: 0 }, skipped: 0 }
  if (!Object.values(rows).some(section => section.length))
    return plan

  const current = targetId
    ? exportPersonalRows([targetId], new Map([[targetId, targetId]]))
    : undefined
  const resolveCycleId = cycleIdentities(rows, current)
  const cycles = planCycles(
    rows,
    current,
    plan,
    resolveCycleId,
    mode === 'move',
  )
  planDiary(rows, current, cycles, resolveCycleId, plan, mode)
  const playback = new Map(
    (current?.cyclePlayback ?? []).map(row => [viewingKey(row), row]),
  )
  const preferences = new Map(
    (current?.titlePreferences ?? []).map(row => [row.title, row]),
  )

  for (const row of rows.cyclePlayback) {
    if (!newest(playback.get(viewingKey(row)), row)) {
      plan.unchanged++
      plan.unchangedTitles.add(row.title)
      continue
    }

    plan.writes.push((profileId, journal) => {
      journal?.record('cyclePlayback', [...keysOf(row)], row.title)
      const data = {
        watchedAt: row.watchedAt ? new Date(row.watchedAt) : null,
        lastPlayedAt: row.lastPlayedAt ? new Date(row.lastPlayedAt) : null,
        updatedAt: new Date(row.updatedAt),
      }
      getDb()
        .insert(cyclePlaybackFacts)
        .values({
          ...data,
          profileId,
          titleId: row.title,
          season: row.season,
          episode: row.episode,
        })
        .onConflictDoUpdate({
          target: [
            cyclePlaybackFacts.profileId,
            cyclePlaybackFacts.titleId,
            cyclePlaybackFacts.season,
            cyclePlaybackFacts.episode,
          ],
          set: data,
        })
        .run()
    })
  }

  for (const row of rows.titlePreferences) {
    if (!newest(preferences.get(row.title), row)) {
      plan.unchanged++
      plan.unchangedTitles.add(row.title)
      continue
    }

    plan.writes.push((profileId, journal) => {
      journal?.record('titlePreferences', [row.title], row.title)
      const data = {
        note: row.note,
        continuation: row.continuation,
        notInterested: row.notInterested,
        updatedAt: new Date(row.updatedAt),
      }
      getDb()
        .insert(mineTitlePreferences)
        .values({ ...data, profileId, titleId: row.title })
        .onConflictDoUpdate({
          target: [
            mineTitlePreferences.profileId,
            mineTitlePreferences.titleId,
          ],
          set: data,
        })
        .run()
    })
  }

  for (const row of rows.profilePreferences) {
    if (!newest(current?.profilePreferences[0], row)) {
      plan.unchanged++
      continue
    }

    plan.writes.push((profileId, journal) => {
      journal?.record('profilePreferences', [], null)
      const collection = row.startCollectionName
        ? visibleCollectionRef(profileId, { name: row.startCollectionName })
        : undefined
      const data = {
        startSection: row.startCollectionName
          ? ('continue' as const)
          : row.startSection,
        startCollectionId: collection?.id ?? null,
        updatedAt: new Date(row.updatedAt),
      }
      getDb()
        .insert(mineProfilePreferences)
        .values({ ...data, profileId })
        .onConflictDoUpdate({
          target: mineProfilePreferences.profileId,
          set: data,
        })
        .run()
    })
  }

  if (plan.history)
    plan.history.skipped = plan.skipped
  return plan
}

export function movePersonalSpace(sourceId: string, targetId: string) {
  const rows = exportPersonalRows([sourceId], new Map([[sourceId, sourceId]]))
  const plan = planPersonalMerge(targetId, rows, 'move')
  for (const write of plan.writes) write(targetId)
}
