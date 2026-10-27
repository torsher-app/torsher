import type { AudioTrack, VoiceType } from '@torsher/release-parser'
import type { MediaFileRef, TitleProgress } from '../../db/schema.ts'
import type { VoiceRef } from './profile.ts'
import { and, desc, eq, gt, inArray, isNotNull, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'
import { isWatched } from '../torrents/playback.ts'

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

export function getTitleProgress(ref: TitleRef) {
  return getDb().select().from(titleProgress).where(whereRef(ref)).get()
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
  > & { mediaFileId?: string | null },
) {
  const updatedAt = new Date()
  const set = isWatched(values.position, values.duration)
    ? { ...values, watchedAt: updatedAt, updatedAt }
    : { ...values, updatedAt }

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
}

/**
 * Раздачу подменили новой версией: «чем смотрели» серии переходит к тому же
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
          ? { torrentId: null, fileIndex: null }
          : { torrentId: newId, fileIndex },
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
 * Файл серии заменили версией из другой раздачи: «чем смотрели» переходит к
 * новому файлу, позиция остаётся.
 */
export function moveFileProgress(from: MediaFileRef, to: MediaFileRef) {
  getDb()
    .update(titleProgress)
    .set({ torrentId: to.torrentId, fileIndex: to.fileIndex })
    .where(
      and(
        eq(titleProgress.torrentId, from.torrentId),
        eq(titleProgress.fileIndex, from.fileIndex),
      ),
    )
    .run()
}

/**
 * Запоминает раздачу и её озвучку при выборе из карточки, не трогая позицию:
 * по студии следующая серия получает «Как в прошлых сериях».
 */
export function rememberChoice(
  ref: TitleRef,
  choice: { torrentId: string, fileIndex: number, voice?: AudioTrack },
) {
  const values = {
    torrentId: choice.torrentId,
    fileIndex: choice.fileIndex,
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
      ...values,
    })
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
}

/**
 * Озвучка, выбранная в плеере: по ней серия откроется с той же дорожкой, а
 * следующие серии сезона — «как в прошлых сериях». Позицию и раздачу не трогает.
 */
export function rememberVoice(ref: TitleRef, voice: AudioTrack) {
  const values = {
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
      ...values,
    })
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
}

/**
 * Отметка «просмотрено» с карточки или её снятие; позиция в обоих случаях
 * сбрасывается: отмеченную серию не продолжают с середины. Раздачу и озвучку
 * серии не трогает — по ним работает «как в прошлых сериях».
 */
export function markWatched(ref: TitleRef, watched: boolean) {
  const values = watched
    ? { position: 0, watchedAt: new Date() }
    : { position: 0, duration: null, watchedAt: null }

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

  return new Set(rows.map(row => row.titleId))
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
 * только отмеченные с карточки, раздачи не имеют и сюда не попадают.
 */
export function lastTitleProgress(profileId: string, titleId: string) {
  return getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        eq(titleProgress.titleId, titleId),
        progressSeen(),
        // Смотрели в плеере: раздачу или файл библиотеки, а не отметили с карточки
        or(
          isNotNull(titleProgress.torrentId),
          isNotNull(titleProgress.mediaFileId),
        ),
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
