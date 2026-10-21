import type { VoiceType } from '@torsher/release-parser'
import type { VoiceRef } from './profile.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleVoices } from '../../db/schema.ts'

/** Озвучка, которую пользователь закрепил за сезоном (у фильма — сезон 0) */
export function getPinnedVoice(
  titleId: string,
  season: number,
): VoiceRef | undefined {
  const row = getDb()
    .select()
    .from(titleVoices)
    .where(
      and(eq(titleVoices.titleId, titleId), eq(titleVoices.season, season)),
    )
    .get()

  if (!row || (!row.studio && !row.type))
    return undefined

  return {
    studio: row.studio ?? undefined,
    type: (row.type as VoiceType | null) ?? undefined,
  }
}

/** Закрепляет озвучку за сезоном; `null` снимает закрепление */
export function pinVoice(
  titleId: string,
  season: number,
  voice: VoiceRef | null,
) {
  const db = getDb()

  if (!voice || (!voice.studio && !voice.type)) {
    db.delete(titleVoices)
      .where(
        and(eq(titleVoices.titleId, titleId), eq(titleVoices.season, season)),
      )
      .run()
    return
  }

  const values = {
    studio: voice.studio ?? null,
    // Студия однозначнее типа: тип храним, только когда студии нет
    type: voice.studio ? null : (voice.type ?? null),
    updatedAt: new Date(),
  }

  db.insert(titleVoices)
    .values({ titleId, season, ...values })
    .onConflictDoUpdate({
      target: [titleVoices.titleId, titleVoices.season],
      set: values,
    })
    .run()
}
