import { rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MIGRATIONS_DIR } from '../../db/index.ts'
import {
  migrationsBefore,
  readMigrationsJournal,
} from '../../db/fixtures/index.ts'
import * as schema from '../../db/schema.ts'
import { getTitleProgress, markWatched } from '../sources/progress.ts'
import { undoImport } from './imports.ts'

const holder = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof drizzle<typeof schema>> | undefined,
}))
vi.mock('../../db/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/index.ts')>()
  return { ...actual, getDb: () => holder.db! }
})

const PROFILE = 'legacy-viewer'
const MOVIE = 'tmdb:movie:21'
const RATED = 'tmdb:movie:23'
const ID = 'legacy-import'

let sqlite: Database.Database
let previous: string

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  holder.db = drizzle(sqlite, { schema })
  const index = readMigrationsJournal().entries.findIndex(
    entry => entry.tag === '0049_mine-personal-space',
  )
  expect(index).toBeGreaterThan(0)
  previous = migrationsBefore(index)
  migrate(holder.db, { migrationsFolder: previous })
  const applied = Date.now()
  sqlite
    .prepare(
      `
    INSERT INTO profiles (id,name,color,position,created_at) VALUES (?,?,?,?,?)
  `,
    )
    .run(PROFILE, 'Older viewer', 'blue', 0, 0)
  sqlite
    .prepare(
      `
    INSERT INTO title_progress
      (profile_id,title_id,season,episode,position,duration,media_file_id,voice_studio,updated_at,watched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `,
    )
    .run(
      PROFILE,
      MOVIE,
      0,
      0,
      90,
      100,
      'later-choice',
      'Later voice',
      applied,
      applied,
    )
  sqlite
    .prepare(
      `
    INSERT INTO profile_titles (profile_id,title_id,rating,rated_at,updated_at,watched_marked_at)
    VALUES (?,?,?,?,?,?)
  `,
    )
    .run(PROFILE, RATED, 9, applied, applied, applied)
  const playedSource = {
    kind: 'library',
    mediaFileId: 'original-file',
    torrentId: null,
    fileIndex: null,
    quality: 'SD',
    voice: { studio: 'Original voice' },
  }
  sqlite
    .prepare(
      `
    INSERT INTO profile_imports(id,profile_id,sources,conflicts,summary,undo,applied_at)
    VALUES (?,?,?,?,?,?,?)
  `,
    )
    .run(
      ID,
      PROFILE,
      'torsher',
      'newer',
      JSON.stringify({
        imported: 2,
        unchanged: 0,
        unmatched: 0,
      }),
      JSON.stringify([
        {
          table: 'progress',
          titleId: MOVIE,
          season: 0,
          episode: 0,
          after: applied,
          before: {
            position: 30,
            duration: 100,
            torrentId: null,
            fileIndex: null,
            mediaFileId: 'original-file',
            playedSource,
            voiceStudio: 'Original voice',
            voiceType: null,
            watchedAt: null,
            updatedAt: 1,
          },
        },
        {
          titleId: RATED,
          before: {
            watchlistAt: null,
            favoriteAt: null,
            droppedAt: null,
            rating: 5,
            ratedAt: 10,
            updatedAt: 10,
          },
        },
      ]),
      applied,
    )
  migrate(holder.db, { migrationsFolder: MIGRATIONS_DIR })
})

afterEach(() => {
  sqlite.close()
  rmSync(previous, { recursive: true, force: true })
  holder.db = undefined
})

describe('undo saved before the personal space migration', () => {
  it('preserves newer source-only choices and fields absent from the older journal', () => {
    const ref = { profileId: PROFILE, titleId: MOVIE }
    expect(getTitleProgress(ref)?.mutationToken).toBeNull()
    const mine = holder
      .db!
      .select()
      .from(schema.profileTitles)
      .where(eq(schema.profileTitles.titleId, RATED))
      .get()!

    expect(undoImport(PROFILE, ID)).toEqual({ kept: 0, restored: 2 })
    expect(getTitleProgress(ref)).toMatchObject({
      position: 30,
      watchedAt: null,
      mediaFileId: 'later-choice',
      playedSource: { kind: 'library', mediaFileId: 'original-file' },
      voiceStudio: 'Later voice',
      mutationToken: expect.any(String),
    })
    expect(
      holder
        .db!.select()
        .from(schema.profileTitles)
        .where(eq(schema.profileTitles.titleId, RATED))
        .get(),
    ).toMatchObject({
      rating: 5,
      watchedMarkedAt: mine.watchedMarkedAt,
      mutationToken: expect.any(String),
    })
  })

  it('skips later writes once a legacy row has a new token', () => {
    const ref = { profileId: PROFILE, titleId: MOVIE }
    const initial = getTitleProgress(ref)!
    markWatched(ref, false)
    const updated = getTitleProgress(ref)!
    expect(updated.updatedAt).toEqual(initial.updatedAt)
    expect(updated.mutationToken).not.toBeNull()
    expect(undoImport(PROFILE, ID)).toEqual({ kept: 1, restored: 1 })
    expect(getTitleProgress(ref)).toEqual(updated)
  })
})
