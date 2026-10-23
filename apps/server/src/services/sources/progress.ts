import type { AudioTrack, VoiceType } from '@torsher/release-parser'
import type { TitleProgress } from '../../db/schema.ts'
import type { VoiceRef } from './profile.ts'
import { and, desc, eq, gt, inArray, isNotNull, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'

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

export function getTitleProgress(ref: TitleRef) {
  return getDb().select().from(titleProgress).where(whereRef(ref)).get()
}

/** Позиция серии из плеера; раздача и файл — чем смотрели последний раз */
export function saveTitleProgress(
  ref: TitleRef,
  values: Pick<
    TitleProgress,
    'position' | 'duration' | 'torrentId' | 'fileIndex'
  > & { mediaFileId?: string | null },
) {
  const updatedAt = new Date()

  return getDb()
    .insert(titleProgress)
    .values({
      profileId: ref.profileId,
      titleId: ref.titleId,
      ...keyOf(ref),
      ...values,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        titleProgress.profileId,
        titleProgress.titleId,
        titleProgress.season,
        titleProgress.episode,
      ],
      set: { ...values, updatedAt },
    })
    .returning()
    .get()
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
 * Отметка «просмотрено» с карточки: досмотренная позиция или сброс. Раздачу
 * и озвучку серии не трогает — по ним работает «как в прошлых сериях».
 */
export function markWatched(ref: TitleRef, watched: boolean) {
  // Позиция в самом конце: «досмотрено» и следующая серия — цель «Продолжить»
  const values = watched
    ? { position: 1, duration: 1 }
    : { position: 0, duration: null }

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
        gt(titleProgress.position, 0),
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
        gt(titleProgress.position, 0),
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
