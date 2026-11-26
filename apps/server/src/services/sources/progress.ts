import type { PreparedPlayedSource, SourceRef } from './playedSource.ts'
import {
  capturePlayedSource,
  freezePlayedSource,
  sameSource,
} from './playedSource.ts'
import type { PlayedVoice } from '../library/playedSource.ts'
import type { DiagnosticContext } from '../diagnostics/index.ts'
import { recordCheckpoint } from '../diagnostics/index.ts'
import { assertMaintenancePolicyChange } from '../libraryMaintenance/admission.ts'
import type { AudioTrack, VoiceType } from '@torsher/release-parser'
import type { MediaFileRef, TitleProgress } from '../../db/schema.ts'
import type { VoiceRef } from './profile.ts'
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'
import { clearWatchedMark, watchedMarkedTitles } from '../mine/marks.ts'
import { clearViewingSeen } from '../mine/viewing.ts'
import { isWatched } from '../torrents/playback.ts'

export { freezeLibraryProgress } from '../library/playedSource.ts'

/** Тайтл и серия в прогрессе профиля; у фильма сезона и серии нет */
export interface TitleRef {
  profileId: string
  titleId: string
  season?: number
  episode?: number
}

function keyOf(ref: TitleRef) {
  return { season: ref.season ?? 0, episode: ref.episode ?? 0 }
}

function whereRef(ref: TitleRef) {
  const { season, episode } = keyOf(ref)

  return and(
    eq(titleProgress.profileId, ref.profileId),
    eq(titleProgress.titleId, ref.titleId),
    eq(titleProgress.season, season),
    eq(titleProgress.episode, episode),
  )
}

/** Просмотрено: досмотр в плеере или отметка с карточки, а не текущая позиция */
export function isProgressWatched(row: Pick<TitleProgress, 'watchedAt'>) {
  return row.watchedAt !== null
}

/** Смотрели или отметили просмотренным: строка не просто выбор раздачи */
export function hasProgress(
  row: Pick<TitleProgress, 'position' | 'watchedAt'>,
) {
  return row.position > 0 || row.watchedAt !== null
}

/** `hasProgress` в запросе */
export function progressSeen() {
  return or(gt(titleProgress.position, 0), isNotNull(titleProgress.watchedAt))
}

/** История запуска: импорт сохраняет позицию, но не локальные ссылки на источник. */
export function playbackSeen() {
  return and(
    progressSeen(),
    or(gt(titleProgress.position, 0), isNotNull(titleProgress.lastPlayedAt)),
  )
}

export function getTitleProgress(ref: TitleRef) {
  return getDb().select().from(titleProgress).where(whereRef(ref)).get()
}

function choiceKey(ref: TitleRef) {
  const { season, episode } = keyOf(ref)
  return JSON.stringify([ref.profileId, ref.titleId, season, episode])
}

export function sameTitleRef(a: TitleRef, b: TitleRef) {
  return choiceKey(a) === choiceKey(b)
}

function sourceFields(row?: SourceRef) {
  return {
    torrentId: row?.torrentId ?? null,
    fileIndex: row?.fileIndex ?? null,
    mediaFileId: row?.mediaFileId ?? null,
    lastSourceKind: row?.lastSourceKind ?? null,
  }
}

const CHOICE_STAMP_LIMIT = 1024
const choiceStamps = new Map<string, object>()

export interface LaunchSelection {
  source: ReturnType<typeof sourceFields>
  voiceStudio: string | null
  voiceType: string | null
  stamp: object
}

function invalidateLaunchSelection(ref: TitleRef) {
  choiceStamps.delete(choiceKey(ref))
}

/** An audio preference can be accepted before the replacement stream is ready. */
export function rememberVoiceIntent(ref: TitleRef) {
  getDb()
    .update(titleProgress)
    .set({
      voiceSelectionRevision: sql`${titleProgress.voiceSelectionRevision} + 1`,
    })
    .where(whereRef(ref))
    .run()
  invalidateLaunchSelection(ref)
}

export function launchSelectionOf(
  ref: TitleRef,
  row?: TitleProgress,
): LaunchSelection {
  const key = choiceKey(ref)
  const stamp = choiceStamps.get(key) ?? {}
  choiceStamps.delete(key)
  choiceStamps.set(key, stamp)
  if (choiceStamps.size > CHOICE_STAMP_LIMIT)
    choiceStamps.delete(choiceStamps.keys().next().value!)
  return {
    source: sourceFields(row),
    voiceStudio: row?.voiceStudio ?? null,
    voiceType: row?.voiceType ?? null,
    stamp,
  }
}

export function launchSelectionCurrent(
  ref: TitleRef,
  launch: LaunchSelection,
  row?: TitleProgress,
) {
  const current = sourceFields(row)
  return (
    choiceStamps.get(choiceKey(ref)) === launch.stamp
    && current.torrentId === launch.source.torrentId
    && current.fileIndex === launch.source.fileIndex
    && current.mediaFileId === launch.source.mediaFileId
    && current.lastSourceKind === launch.source.lastSourceKind
    && (row?.voiceStudio ?? null) === launch.voiceStudio
    && (row?.voiceType ?? null) === launch.voiceType
  )
}

/**
 * Позиция серии из плеера; раздача и файл — чем смотрели последний раз.
 * Досмотр ставит отметку, а позиция пересмотра её не снимает
 */
export function saveTitleProgress(
  ref: TitleRef,
  values: Pick<
    TitleProgress,
    'position' | 'duration' | 'torrentId' | 'fileIndex'
  >
  & Pick<SourceRef, 'mediaFileId' | 'lastSourceKind'>,
  context?: DiagnosticContext,
  preparedSource?: PreparedPlayedSource | 'unknown',
  playedVoice: PlayedVoice = null,
  launch?: LaunchSelection,
) {
  assertMaintenancePolicyChange({ titleId: ref.titleId })

  const before = getTitleProgress(ref)
  const source = { ...values, ...sourceFields(values) }
  const previous = before && freezePlayedSource(before)
  const playedSource
    = preparedSource === 'unknown'
      ? { kind: 'unknown' as const }
      : capturePlayedSource(source, playedVoice, previous, preparedSource)
  const updatedAt = new Date()
  // A delayed checkpoint from the playing source must not overwrite a newer
  // unplayed source choice (or attach that choice's voice to the old source).
  const sourceUnchanged
    = !!before
      && (source.lastSourceKind
        ? before.lastSourceKind === source.lastSourceKind
        : sameSource(before, source))
  const pendingChoice
    = preparedSource === 'unknown'
      || (!sourceUnchanged
        && (launch
          ? !launchSelectionCurrent(ref, launch, before)
          : before
            && (before.mediaFileId || before.torrentId || before.lastSourceKind)
            && (!previous || !sameSource(previous, before))))
  const keepRememberedVoice
    = pendingChoice
      || (before && (sourceUnchanged || (!before.mediaFileId && !before.torrentId)))
  const checkpoint = {
    ...source,
    ...(pendingChoice && sourceFields(before)),
    ...(!keepRememberedVoice && {
      voiceStudio: playedVoice?.studio ?? null,
      voiceType: playedVoice?.type ?? null,
    }),
    playedSource,
  }
  const set = isWatched(values.position, values.duration)
    ? {
        ...checkpoint,
        watchedAt: updatedAt,
        lastPlayedAt: updatedAt,
        updatedAt,
      }
    : { ...checkpoint, lastPlayedAt: updatedAt, updatedAt }

  const saved = getDb().transaction(() => {
    if (values.position > 0)
      clearWatchedMark(ref.profileId, ref.titleId)

    return getDb()
      .insert(titleProgress)
      .values({
        profileId: ref.profileId,
        titleId: ref.titleId,
        ...keyOf(ref),
        ...set,
      })
      .onConflictDoUpdate({
        target: [
          titleProgress.profileId,
          titleProgress.titleId,
          titleProgress.season,
          titleProgress.episode,
        ],
        set,
      })
      .returning()
      .get()
  })
  if (!pendingChoice && !sourceUnchanged)
    invalidateLaunchSelection(ref)
  recordCheckpoint('progress.saved', context, {
    ...ref,
    position: saved.position,
    duration: saved.duration,
    torrentId: source.torrentId,
    fileIndex: source.fileIndex,
    mediaFileId: source.mediaFileId,
    previousTorrentId: before?.torrentId,
    previousFileIndex: before?.fileIndex,
    watchedBefore: before ? isProgressWatched(before) : false,
    watchedAfter: isProgressWatched(saved),
    committedAt: updatedAt.toISOString(),
  })
  return saved
}

/**
 * Раздачу подменили новой версией: выбор для продолжения переходит к тому же
 * файлу новой (старый индекс → новый). Файла в новой версии нет — раздача у
 * прогресса снимается, позиция серии остаётся.
 */
export function relinkTitleProgress(
  oldId: string,
  newId: string,
  map: Map<number, number>,
) {
  const db = getDb()
  const rows = db
    .select()
    .from(titleProgress)
    .where(eq(titleProgress.torrentId, oldId))
    .all()

  for (const row of rows) {
    const fileIndex
      = row.fileIndex === null ? undefined : map.get(row.fileIndex)

    db.update(titleProgress)
      .set(
        fileIndex === undefined
          ? {
              torrentId: null,
              fileIndex: null,
              playedSource: freezePlayedSource(row),
            }
          : {
              torrentId: newId,
              fileIndex,
              playedSource: freezePlayedSource(row),
            },
      )
      .where(
        and(
          eq(titleProgress.profileId, row.profileId),
          eq(titleProgress.titleId, row.titleId),
          eq(titleProgress.season, row.season),
          eq(titleProgress.episode, row.episode),
        ),
      )
      .run()
  }
}

/**
 * Файл серии заменили версией из другой раздачи: выбор для продолжения
 * переходит к новому файлу, позиция и фактическая история остаются.
 */
export function moveFileProgress(from: MediaFileRef, to: MediaFileRef) {
  const db = getDb()
  const rows = db
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.torrentId, from.torrentId),
        eq(titleProgress.fileIndex, from.fileIndex),
      ),
    )
    .all()
  for (const row of rows) {
    db.update(titleProgress)
      .set({
        torrentId: to.torrentId,
        fileIndex: to.fileIndex,
        playedSource: freezePlayedSource(row),
      })
      .where(whereRef(row))
      .run()
  }
}

/**
 * Запоминает раздачу и её озвучку при выборе из карточки, не трогая позицию:
 * по студии следующая серия получает «Как в прошлых сериях».
 */
export function rememberChoice(
  ref: TitleRef,
  choice: { torrentId: string, fileIndex: number, voice?: AudioTrack },
) {
  const before = getTitleProgress(ref)
  const values = {
    torrentId: choice.torrentId,
    fileIndex: choice.fileIndex,
    mediaFileId: null,
    lastSourceKind: null,
    playedSource: before ? freezePlayedSource(before) : null,
    voiceStudio: choice.voice?.studio ?? null,
    voiceType: choice.voice?.type ?? null,
  }

  getDb()
    .insert(titleProgress)
    .values({
      profileId: ref.profileId,
      titleId: ref.titleId,
      ...keyOf(ref),
      position: 0,
      voiceSelectionRevision: 1,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        titleProgress.profileId,
        titleProgress.titleId,
        titleProgress.season,
        titleProgress.episode,
      ],
      set: {
        ...values,
        voiceSelectionRevision: sql`${titleProgress.voiceSelectionRevision} + 1`,
      },
    })
    .run()
  invalidateLaunchSelection(ref)
}

/** A confirmed start can select the file before a position is reported. */
export function rememberStartedSource(
  ref: TitleRef,
  source: SourceRef,
  launch: LaunchSelection,
) {
  const before = getTitleProgress(ref)
  if (
    !launchSelectionCurrent(ref, launch, before)
    || (before && sameSource(before, source))
  ) {
    return
  }
  assertMaintenancePolicyChange({ titleId: ref.titleId })
  const values = {
    ...sourceFields(source),
    playedSource: before ? freezePlayedSource(before) : null,
  }
  getDb()
    .insert(titleProgress)
    .values({ ...ref, ...keyOf(ref), position: 0, ...values })
    .onConflictDoUpdate({
      target: [
        titleProgress.profileId,
        titleProgress.titleId,
        titleProgress.season,
        titleProgress.episode,
      ],
      set: values,
    })
    .run()
  invalidateLaunchSelection(ref)
}

/**
 * Озвучка, выбранная в плеере: по ней серия откроется с той же дорожкой, а
 * следующие серии сезона — «как в прошлых сериях». При известном источнике
 * запоминает выбор вместе с ним; фактическую историю и позицию не меняет.
 */
export function rememberVoice(
  ref: TitleRef,
  voice: AudioTrack,
  source?: SourceRef,
  launch?: LaunchSelection,
) {
  const before = getTitleProgress(ref)
  if (launch && !launchSelectionCurrent(ref, launch, before))
    return false
  const values = {
    ...(source && sourceFields(source)),
    playedSource: before ? freezePlayedSource(before) : null,
    voiceStudio: voice.studio ?? null,
    voiceType: voice.type ?? null,
  }

  getDb()
    .insert(titleProgress)
    .values({
      profileId: ref.profileId,
      titleId: ref.titleId,
      ...keyOf(ref),
      position: 0,
      voiceSelectionRevision: 1,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        titleProgress.profileId,
        titleProgress.titleId,
        titleProgress.season,
        titleProgress.episode,
      ],
      set: {
        ...values,
        voiceSelectionRevision: sql`${titleProgress.voiceSelectionRevision} + 1`,
      },
    })
    .run()
  invalidateLaunchSelection(ref)
  return true
}

/**
 * Отметка «просмотрено» с карточки или её снятие; позиция в обоих случаях
 * сбрасывается: отмеченную серию не продолжают с середины. Раздачу и озвучку
 * серии не трогает — по ним работает «как в прошлых сериях».
 */
export function markWatched(ref: TitleRef, watched: boolean) {
  assertMaintenancePolicyChange({ titleId: ref.titleId })

  const before = getTitleProgress(ref)
  const playedSource = before ? freezePlayedSource(before) : null
  const values = watched
    ? { position: 0, watchedAt: new Date(), playedSource }
    : { position: 0, duration: null, watchedAt: null, playedSource }

  getDb().transaction(() => {
    if (!watched) {
      clearWatchedMark(ref.profileId, ref.titleId)
      clearViewingSeen(ref)
    }

    getDb()
      .insert(titleProgress)
      .values({
        profileId: ref.profileId,
        titleId: ref.titleId,
        ...keyOf(ref),
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          titleProgress.profileId,
          titleProgress.titleId,
          titleProgress.season,
          titleProgress.episode,
        ],
        // Время записи — время просмотра: отметка не делает серию «последней»
        set: values,
      })
      .run()
  })
}

/**
 * Тайтлы из списка, которые профиль смотрел или отметил: начатая позиция
 * или отметка «просмотрено» любой серии. Отметки на постерах фильмографии.
 */
export function watchedTitles(profileId: string, titleIds: string[]) {
  if (titleIds.length === 0)
    return new Set<string>()

  const rows = getDb()
    .selectDistinct({ titleId: titleProgress.titleId })
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        inArray(titleProgress.titleId, titleIds),
        progressSeen(),
      ),
    )
    .all()

  const marked = watchedMarkedTitles(profileId)

  return new Set([
    ...rows.map(row => row.titleId),
    ...titleIds.filter(id => marked.has(id)),
  ])
}

/** Прогресс по сериям тайтла: полосы и отметки на карточке */
export function episodeProgress(profileId: string, titleId: string) {
  return getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        eq(titleProgress.titleId, titleId),
        gt(titleProgress.season, 0),
      ),
    )
    .all()
}

/**
 * Последняя серия, которую смотрели в плеере: история и «Продолжить». Серии,
 * только отмеченные с карточки, позиции и источника не имеют и сюда не попадают.
 */
export function lastTitleProgress(profileId: string, titleId: string) {
  return getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        eq(titleProgress.titleId, titleId),
        playbackSeen(),
      ),
    )
    .orderBy(desc(titleProgress.updatedAt))
    .get()
}

/** Озвучка последней серии сезона, у которой она известна */
export function lastVoiceOfSeason(
  profileId: string,
  titleId: string,
  season: number,
): VoiceRef | undefined {
  const row = getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        eq(titleProgress.titleId, titleId),
        eq(titleProgress.season, season),
      ),
    )
    .orderBy(desc(titleProgress.updatedAt))
    .all()
    .find(item => item.voiceStudio || item.voiceType)

  if (!row)
    return undefined

  return row.voiceStudio
    ? { studio: row.voiceStudio }
    : { type: row.voiceType as VoiceType }
}
