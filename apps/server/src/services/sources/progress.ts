import type { AudioTrack, VoiceType } from '@torsher/release-parser'
import type { TitleProgress } from '../../db/schema.ts'
import type { VoiceRef } from './profile.ts'
import { and, desc, eq, gt } from 'drizzle-orm'
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
  >,
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

/** Последняя начатая серия тайтла: для «Продолжить» */
export function lastTitleProgress(profileId: string, titleId: string) {
  return getDb()
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        eq(titleProgress.titleId, titleId),
        gt(titleProgress.position, 0),
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
