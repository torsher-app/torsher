import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { storagePolicy } from '../../db/schema.ts'

export const GIB = 1024 ** 3

export interface StoragePolicy {
  /** Сколько может занять кэш просмотров (раздачи без «Оставить») */
  cacheLimit: number
  /** Сколько оставлять свободным на томе: ниже — просмотр не стартует */
  minFree: number
  /** Владелец сохранил свои значения; иначе — по размеру тома */
  custom: boolean
}

/** Значения по умолчанию масштабируются под маленькие диски мини-ПК */
export function defaultPolicy(total: number): StoragePolicy {
  return {
    cacheLimit: Math.min(200 * GIB, Math.floor(total * 0.5)),
    minFree: Math.min(20 * GIB, Math.floor(total * 0.1)),
    custom: false,
  }
}

const POLICY_ID = 1

export function getPolicy(total: number): StoragePolicy {
  const saved = getDb()
    .select()
    .from(storagePolicy)
    .where(eq(storagePolicy.id, POLICY_ID))
    .get()

  if (!saved)
    return defaultPolicy(total)

  return {
    cacheLimit: saved.cacheLimitBytes,
    minFree: saved.minFreeBytes,
    custom: true,
  }
}

export function savePolicy(values: { cacheLimit: number, minFree: number }) {
  const row = {
    cacheLimitBytes: values.cacheLimit,
    minFreeBytes: values.minFree,
    updatedAt: new Date(),
  }

  getDb()
    .insert(storagePolicy)
    .values({ id: POLICY_ID, ...row })
    .onConflictDoUpdate({ target: storagePolicy.id, set: row })
    .run()
}
