import type { Card } from '../../dto/catalog.ts'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { profiles, profileTitles } from '../../db/schema.ts'

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
 * Оценка на постере по настройке профиля: своя или внешняя из `card.ratings`
 * (их собирают поставщики оценок до вызова). Нет оценки — постер чистый.
 */
export function withPosterRatings(cards: Card[], profileId: string): Card[] {
  const source
    = getDb()
      .select({ posterRating: profiles.posterRating })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .get()
      ?.posterRating ?? 'own'

  if (source === 'tmdb' || source === 'imdb') {
    return cards.map((card) => {
      const rating = card.ratings?.find(item => item.provider === source)
      const trusted = rating && (rating.votes ?? 0) >= MIN_POSTER_VOTES

      return {
        ...card,
        posterRating: trusted ? { source, value: rating.value } : undefined,
      }
    })
  }

  if (source !== 'own')
    return cards.map(card => ({ ...card, posterRating: undefined }))

  const own = ratingsOf(
    profileId,
    cards.map(card => card.id),
  )

  return cards.map((card) => {
    const value = own.get(card.id)

    return {
      ...card,
      posterRating: value ? { source: 'own' as const, value } : undefined,
    }
  })
}
