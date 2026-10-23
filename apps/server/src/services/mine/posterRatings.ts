import type { Card } from '../../dto/catalog.ts'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  posterRatingSources,
  profiles,
  profileTitles,
} from '../../db/schema.ts'

// Оценка по паре голосов на постере только вводит в заблуждение
const MIN_POSTER_VOTES = 20

/** Свои оценки профиля по тайтлам; без оценки тайтла в карте нет */
export function ratingsOf(profileId: string, titleIds: string[]) {
  if (!titleIds.length)
    return new Map<string, number>()

  const rows = getDb()
    .select({ titleId: profileTitles.titleId, rating: profileTitles.rating })
    .from(profileTitles)
    .where(
      and(
        eq(profileTitles.profileId, profileId),
        inArray(profileTitles.titleId, [...new Set(titleIds)]),
        isNotNull(profileTitles.rating),
      ),
    )
    .all()

  return new Map(rows.map(row => [row.titleId, row.rating as number]))
}

/**
 * Значки на постере: своя оценка профиля — всегда, оценки сервисов — по
 * настройке профиля из `card.ratings` (их собирают поставщики оценок до вызова)
 * в порядке поставщиков.
 */
export function withPosterRatings<T extends Card>(
  cards: T[],
  profileId: string,
): T[] {
  const sources: string[] = getDb()
    .select({ posterRatings: profiles.posterRatings })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .get()
    ?.posterRatings ?? ['tmdb']
  const own = ratingsOf(
    profileId,
    cards.map(card => card.id),
  )

  return cards.map((card) => {
    const shown = (card.ratings ?? []).flatMap((rating) => {
      const source = posterRatingSources.find(
        item => item === rating.provider && sources.includes(item),
      )

      return source && (rating.votes ?? 0) >= MIN_POSTER_VOTES
        ? [{ source, value: rating.value }]
        : []
    })

    return {
      ...card,
      posterRatings: shown.length > 0 ? shown : undefined,
      ownRating: own.get(card.id),
    }
  })
}
