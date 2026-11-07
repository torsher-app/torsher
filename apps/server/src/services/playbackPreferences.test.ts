import { eq } from 'drizzle-orm'
import { beforeAll, expect, it } from 'vitest'
import { getDb, migrateDb } from '../db/index.ts'
import { playbackPreferences, profiles } from '../db/schema.ts'
import {
  getPlaybackPreferences,
  savePlaybackPreferences,
} from './playbackPreferences.ts'

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(profiles)
    .values([
      { id: 'a', name: 'A', color: 'violet' },
      { id: 'b', name: 'B', color: 'violet' },
    ])
    .run()
})
it('isolates profile and title, merges audio/subtitles, and cascades profile deletion', () => {
  savePlaybackPreferences('a', 'show', {
    audio: { language: 'rus', studio: null, voiceType: 'D' },
  })
  savePlaybackPreferences('a', 'show', {
    subtitles: { enabled: false, language: null, forced: false },
  })
  expect(getPlaybackPreferences('a', 'show')).toMatchObject({
    audio: { voiceType: 'D' },
    subtitles: { enabled: false },
  })
  expect(getPlaybackPreferences('b', 'show')).toBeUndefined()
  expect(getPlaybackPreferences('a', 'other')).toBeUndefined()
  getDb().delete(profiles).where(eq(profiles.id, 'a')).run()
  expect(getDb().select().from(playbackPreferences).all()).toEqual([])
})
