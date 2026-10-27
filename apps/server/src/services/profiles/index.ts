import type { PlayerSettings, Profile } from '../../db/schema.ts'
import { and, asc, desc, eq, inArray, lt, notExists, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  followProfiles,
  follows,
  profiles,
  profileTitles,
  titleProgress,
  users,
  watchStates,
} from '../../db/schema.ts'
import { hashPassword, verifyPassword } from '../../utils/password.ts'

export { checkPinAttempt, PinLockedError, resetPinAttempts } from './pin.ts'

export type ProfileColor = Profile['color']
export type ProfileLanguage = NonNullable<Profile['language']>

export interface ProfileInput {
  name: string
  color: ProfileColor
  language: ProfileLanguage | null
  ageLimit: number | null
  posterRatings?: Profile['posterRatings']
}

/** Последний профиль удалить нельзя: витрине и сессии владельца нужен профиль */
export class LastProfileError extends Error {
  constructor() {
    super('The last profile cannot be deleted')
    this.name = 'LastProfileError'
  }
}

const DEFAULT_COLOR: ProfileColor = 'violet'

export function listProfiles() {
  return getDb()
    .select()
    .from(profiles)
    .orderBy(asc(profiles.position), asc(profiles.createdAt))
    .all()
}

export function getProfile(id: string) {
  return getDb().select().from(profiles).where(eq(profiles.id, id)).get()
}

/**
 * Профиль по умолчанию — первый по порядку. Без профилей (сервер обновили
 * до появления аккаунта) создаётся профиль с именем владельца.
 */
export function defaultProfile(): Profile {
  const first = listProfiles()[0]

  if (first)
    return first

  const owner = getDb()
    .select({ name: users.username })
    .from(users)
    .orderBy(asc(users.createdAt))
    .get()

  return ensureDefaultProfile(owner?.name ?? 'Profile')
}

/** Первый профиль сервера; если профили уже есть, ничего не меняет */
export function ensureDefaultProfile(name: string) {
  return getDb().transaction((tx) => {
    const existing = tx
      .select()
      .from(profiles)
      .orderBy(asc(profiles.position), asc(profiles.createdAt))
      .get()

    if (existing)
      return existing

    return tx
      .insert(profiles)
      .values({ name, color: DEFAULT_COLOR, position: 0 })
      .returning()
      .get()
  })
}

export function createProfile(input: ProfileInput & { pinHash?: string }) {
  const last = getDb()
    .select({ position: profiles.position })
    .from(profiles)
    .orderBy(desc(profiles.position))
    .get()

  return getDb()
    .insert(profiles)
    .values({ ...input, position: (last?.position ?? -1) + 1 })
    .returning()
    .get()
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  autoNext: true,
  subtitleSize: 'm',
  subtitleBackground: 'box',
}

export function playerSettingsOf(row: Pick<Profile, 'player'>): PlayerSettings {
  return { ...DEFAULT_PLAYER_SETTINGS, ...row.player }
}

/** Меняет только переданные настройки, остальные остаются как были */
export function updatePlayerSettings(
  id: string,
  patch: Partial<PlayerSettings>,
) {
  const row = getProfile(id)

  if (!row)
    return undefined

  const player = { ...row.player, ...patch }

  getDb().update(profiles).set({ player }).where(eq(profiles.id, id)).run()

  return playerSettingsOf({ player })
}

export function updateProfile(id: string, input: Partial<ProfileInput>) {
  return getDb()
    .update(profiles)
    .set(input)
    .where(eq(profiles.id, id))
    .returning()
    .get()
}

export async function setPin(id: string, pin: string | null) {
  const pinHash = pin === null ? null : await hashPassword(pin)

  return getDb()
    .update(profiles)
    .set({ pinHash })
    .where(eq(profiles.id, id))
    .returning()
    .get()
}

export function verifyPin(profile: Profile, pin: string | undefined) {
  if (!profile.pinHash)
    return Promise.resolve(true)

  return pin ? verifyPassword(pin, profile.pinHash) : Promise.resolve(false)
}

/**
 * Удаляет профиль. С `moveTo` его позиции и прогресс переходят в другой
 * профиль: при совпадении остаётся более свежая запись. Без `moveTo` они
 * удаляются вместе с профилем (каскад).
 */
export function deleteProfile(id: string, moveTo?: string) {
  getDb().transaction((tx) => {
    const count = tx
      .select({ count: sql<number>`count(*)` })
      .from(profiles)
      .get()

    if ((count?.count ?? 0) <= 1)
      throw new LastProfileError()

    if (moveTo) {
      for (const row of tx
        .select()
        .from(titleProgress)
        .where(eq(titleProgress.profileId, id))
        .all()) {
        tx.insert(titleProgress)
          .values({ ...row, profileId: moveTo })
          .onConflictDoUpdate({
            target: [
              titleProgress.profileId,
              titleProgress.titleId,
              titleProgress.season,
              titleProgress.episode,
            ],
            set: { ...row, profileId: moveTo },
            setWhere: lt(titleProgress.updatedAt, row.updatedAt),
          })
          .run()
      }

      for (const row of tx
        .select()
        .from(watchStates)
        .where(eq(watchStates.profileId, id))
        .all()) {
        tx.insert(watchStates)
          .values({ ...row, profileId: moveTo })
          .onConflictDoUpdate({
            target: [
              watchStates.profileId,
              watchStates.torrentId,
              watchStates.fileIndex,
            ],
            set: { ...row, profileId: moveTo },
            setWhere: lt(watchStates.updatedAt, row.updatedAt),
          })
          .run()
      }

      // Списки объединяются, оценка остаётся более свежая
      for (const row of tx
        .select()
        .from(profileTitles)
        .where(eq(profileTitles.profileId, id))
        .all()) {
        tx.insert(profileTitles)
          .values({ ...row, profileId: moveTo })
          .onConflictDoUpdate({
            target: [profileTitles.profileId, profileTitles.titleId],
            set: {
              watchlistAt: sql`coalesce(${profileTitles.watchlistAt}, excluded.watchlist_at)`,
              favoriteAt: sql`coalesce(${profileTitles.favoriteAt}, excluded.favorite_at)`,
              droppedAt: sql`coalesce(${profileTitles.droppedAt}, excluded.dropped_at)`,
              rating: sql`case when excluded.rated_at > coalesce(${profileTitles.ratedAt}, 0) then excluded.rating else ${profileTitles.rating} end`,
              ratedAt: sql`case when excluded.rated_at > coalesce(${profileTitles.ratedAt}, 0) then excluded.rated_at else ${profileTitles.ratedAt} end`,
              updatedAt: row.updatedAt,
            },
          })
          .run()
      }
    }

    const subscribed = tx
      .select({ followId: followProfiles.followId })
      .from(followProfiles)
      .where(eq(followProfiles.profileId, id))
      .all()
      .map(row => row.followId)

    if (moveTo) {
      for (const followId of subscribed) {
        tx.insert(followProfiles)
          .values({ followId, profileId: moveTo, createdAt: new Date() })
          .onConflictDoNothing()
          .run()
      }
    }

    tx.delete(profiles).where(eq(profiles.id, id)).run()

    // Профиль был последним подписчиком — слежение останавливается, как при отписке
    if (subscribed.length) {
      tx.update(follows)
        .set({ state: 'stopped', nextSearchAt: null, updatedAt: new Date() })
        .where(
          and(
            inArray(follows.id, subscribed),
            inArray(follows.state, ['active', 'paused']),
            notExists(
              tx
                .select({ id: followProfiles.followId })
                .from(followProfiles)
                .where(eq(followProfiles.followId, follows.id)),
            ),
          ),
        )
        .run()
    }
  })
}
