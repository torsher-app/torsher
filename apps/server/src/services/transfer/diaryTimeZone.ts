import { getDb } from '../../db/index.ts'
import { serverSettings } from '../../db/schema.ts'
import { getSetting } from '../settings/index.ts'

const SETTING = 'mine.diaryTimeZone'

export function isDiaryTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Z][\w+/-]*$/i.test(value))
    return false

  try {
    return !!new Intl.DateTimeFormat('en', {
      timeZone: value,
    }).resolvedOptions().timeZone
  }
  catch {
    return false
  }
}

function serverTimeZone() {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
  return isDiaryTimeZone(zone) ? zone : 'UTC'
}

export function diaryTimeZone() {
  const saved = getSetting(SETTING)
  return isDiaryTimeZone(saved) ? saved : serverTimeZone()
}

/** Pin the server's diary zone on first use. Server restore may supply its origin zone. */
export function ensureDiaryTimeZone(originZone?: string) {
  getDb()
    .insert(serverSettings)
    .values({
      key: SETTING,
      value: isDiaryTimeZone(originZone) ? originZone : serverTimeZone(),
    })
    .onConflictDoNothing()
    .run()

  return diaryTimeZone()
}
