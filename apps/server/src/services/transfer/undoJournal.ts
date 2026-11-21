import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { getTableColumns, getTableName, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  cyclePlaybackFacts,
  cycleProgress,
  diaryEntries,
  diarySeen,
  mineProfilePreferences,
  mineTitlePreferences,
  profileTitles,
  rewatchCycles,
  titleProgress,
} from '../../db/schema.ts'
import { assertMaintenancePolicyChange } from '../libraryMaintenance/admission.ts'

import { visibleCollectionRef } from '../collections/index.ts'

function projection<T extends SQLiteTable>(
  table: T,
  keys: Array<keyof T['_']['columns'] & string>,
  local: string[] = [],
) {
  const columns = getTableColumns(table)
  return {
    name: getTableName(table),
    keys: keys.map(key => columns[key]!.name),
    restorable: Object.values(columns)
      .map(column => column.name)
      .filter(
        name =>
          name !== 'profile_id'
          && name !== 'mutation_token'
          && !local.includes(name),
      ),
  }
}

const projections = {
  progress: projection(titleProgress, ['titleId', 'season', 'episode']),
  mine: projection(profileTitles, ['titleId']),
  diary: projection(diaryEntries, ['id']),
  seen: projection(diarySeen, ['titleId', 'season', 'episode']),
  cycle: projection(
    rewatchCycles,
    ['id'],
    ['lifecycle_revision', 'create_request_id'],
  ),
  cycleProgress: projection(cycleProgress, ['cycleId', 'season', 'episode']),
  cyclePlayback: projection(cyclePlaybackFacts, [
    'titleId',
    'season',
    'episode',
  ]),
  titlePreferences: projection(mineTitlePreferences, ['titleId']),
  profilePreferences: projection(mineProfilePreferences, []),
}

type Projection = keyof typeof projections
type Key = Array<number | string>
type Snapshot = Record<string, string | number | null>

interface Participant {
  table: Projection
  key: Key
  // null stands for a row that did not exist, including an absent witness.
  before: Snapshot | null
  changed: boolean
}

interface UndoParticipant extends Participant {
  afterToken: string | null
}

interface UndoGroup {
  titleId: string | null
  participants: UndoParticipant[]
}

export interface ImportUndoJournal {
  version: 2
  groups: UndoGroup[]
}

function rowLocation(profileId: string, table: Projection, key: Key) {
  const { name, keys } = projections[table]
  return {
    table: sql.identifier(name),
    where: sql.join(
      [
        sql`profile_id = ${profileId}`,
        ...keys.map(
          (column, index) => sql`${sql.identifier(column)} = ${key[index]}`,
        ),
      ],
      sql` AND `,
    ),
  }
}

function readRow(profileId: string, table: Projection, key: Key) {
  const location = rowLocation(profileId, table, key)
  const row = getDb().get<Snapshot>(sql`
    SELECT * FROM ${location.table} WHERE ${location.where}
  `)

  if (!row)
    return null

  return row
}

/**
 * Records before values once and reads post-images after all writes and SQLite
 * triggers have run. All calls belong to the caller's import transaction.
 */
export class UndoJournalBuilder {
  private groups = new Map<
    string,
    { titleId: string | null, rows: Map<string, Participant> }
  >()

  private profileId: string

  constructor(profileId: string) {
    this.profileId = profileId
  }

  record(
    table: Projection,
    key: Key,
    titleId: string | null,
    options: { group?: string, changed?: boolean, beforePatch?: Snapshot } = {},
  ) {
    const {
      group = JSON.stringify([table, key]),
      changed = true,
      beforePatch,
    } = options
    const members = this.groups.get(group) ?? { titleId, rows: new Map() }
    this.groups.set(group, members)

    const identity = JSON.stringify([table, key])
    const recorded = members.rows.get(identity)
    if (recorded) {
      recorded.changed ||= changed
      return
    }

    const before = readRow(this.profileId, table, key)
    if (before)
      delete before.mutation_token

    members.rows.set(identity, {
      table,
      key,
      before: before && { ...before, ...beforePatch },
      changed,
    })
  }

  finish(): ImportUndoJournal {
    const groups: UndoGroup[] = []

    for (const { titleId, rows } of this.groups.values()) {
      if (![...rows.values()].some(row => row.changed))
        continue

      const participants = [...rows.values()].map((row): UndoParticipant => {
        const current = readRow(this.profileId, row.table, row.key)
        const token = current?.mutation_token
        if ((row.changed || current) && typeof token !== 'string') {
          throw new Error(
            `Import participant ${row.table} has no mutation token`,
          )
        }
        return { ...row, afterToken: typeof token === 'string' ? token : null }
      })

      groups.push({ titleId, participants })
    }

    return { version: 2, groups }
  }
}

function hasNewUnfinishedCycle(
  profileId: string,
  participant: UndoParticipant,
  group: UndoParticipant[],
) {
  if (
    !participant.changed
    || participant.table !== 'cycle'
    || !participant.before
    || participant.before.state === 'ended'
  ) {
    return false
  }

  const conflict = getDb().get<{ id: string }>(sql`
    SELECT id FROM rewatch_cycles
    WHERE profile_id = ${profileId} AND title_id = ${participant.before.title_id}
      AND id != ${participant.key[0]} AND state IN ('active', 'paused')
  `)
  return (
    !!conflict
    && !group.some(
      row =>
        row.changed
        && row.table === 'cycle'
        && row.key[0] === conflict.id
        && (!row.before || row.before.state === 'ended'),
    )
  )
}

function restoreRow(profileId: string, participant: UndoParticipant) {
  const location = rowLocation(profileId, participant.table, participant.key)
  let { before } = participant
  if (!before) {
    getDb().run(sql`DELETE FROM ${location.table} WHERE ${location.where}`)
    return
  }

  if (
    participant.table === 'profilePreferences'
    && typeof before.start_collection_id === 'string'
    && !visibleCollectionRef(profileId, { id: before.start_collection_id })
  ) {
    before = {
      ...before,
      start_collection_id: null,
      start_section: 'continue',
    }
  }
  const values = before

  getDb().run(sql`
    UPDATE ${location.table}
    SET ${sql.join(
      projections[participant.table].restorable
        .filter(column => Object.hasOwn(values, column))
        .map(column => sql`${sql.identifier(column)} = ${values[column]}`),
      sql`, `,
    )}
    WHERE ${location.where}
  `)
}

export function undoJournal(profileId: string, journal: ImportUndoJournal) {
  assertMaintenancePolicyChange({ global: true })
  let restored = 0
  let kept = 0

  for (const { participants } of journal.groups) {
    const changes = participants.filter(row => row.changed)
    const clean = participants.every((row) => {
      const current = readRow(profileId, row.table, row.key)
      return (
        (row.afterToken === null
          ? current === null
          : current?.mutation_token === row.afterToken)
        && !hasNewUnfinishedCycle(profileId, row, participants)
      )
    })

    if (!clean) {
      kept += changes.length
      continue
    }

    // Cursors must be undone before their parent cycle. Both were guarded above.
    for (const row of changes.reverse()) restoreRow(profileId, row)

    restored += changes.length
  }

  return { restored, kept }
}
