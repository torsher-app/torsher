import type { Collection } from '../../db/schema.ts'
import { and, desc, eq, inArray, notExists, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  collectionHiddenProfiles,
  collections,
  collectionTitles,
  profiles,
} from '../../db/schema.ts'

export class CollectionNameTakenError extends Error {
  constructor() {
    super('Collection with this name already exists')
  }
}

export interface CollectionWithCounts extends Collection {
  count: number
  hiddenFrom: string[]
}

export interface CollectionInput {
  name: string
  showOnHome?: boolean
  hiddenFrom?: string[]
}

const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
})

function nameKeyOf(name: string) {
  return name.normalize('NFC').trim().toLocaleLowerCase()
}

function byName(a: { name: string }, b: { name: string }) {
  return collator.compare(a.name, b.name)
}

function countsOf(ids: string[]) {
  if (!ids.length)
    return new Map<string, number>()

  const rows = getDb()
    .select({
      id: collectionTitles.collectionId,
      count: sql<number>`count(*)`,
    })
    .from(collectionTitles)
    .where(inArray(collectionTitles.collectionId, ids))
    .groupBy(collectionTitles.collectionId)
    .all()

  return new Map(rows.map(row => [row.id, row.count]))
}

function hiddenOf(ids: string[]) {
  const hidden = new Map<string, string[]>()

  if (!ids.length)
    return hidden

  for (const row of getDb()
    .select()
    .from(collectionHiddenProfiles)
    .where(inArray(collectionHiddenProfiles.collectionId, ids))
    .all()) {
    hidden.set(row.collectionId, [
      ...(hidden.get(row.collectionId) ?? []),
      row.profileId,
    ])
  }

  return hidden
}

function withCounts(rows: Collection[]): CollectionWithCounts[] {
  const ids = rows.map(row => row.id)
  const counts = countsOf(ids)
  const hidden = hiddenOf(ids)

  return rows
    .map(row => ({
      ...row,
      count: counts.get(row.id) ?? 0,
      hiddenFrom: hidden.get(row.id) ?? [],
    }))
    .sort(byName)
}

/** Все подборки — для панели */
export function listCollections() {
  return withCounts(getDb().select().from(collections).all())
}

/** Подборки, которые профиль видит, по названию */
export function visibleCollections(profileId: string) {
  return withCounts(
    getDb()
      .select()
      .from(collections)
      .where(
        notExists(
          getDb()
            .select()
            .from(collectionHiddenProfiles)
            .where(
              and(
                eq(collectionHiddenProfiles.collectionId, collections.id),
                eq(collectionHiddenProfiles.profileId, profileId),
              ),
            ),
        ),
      )
      .all(),
  )
}

export function getCollection(id: string) {
  return getDb().select().from(collections).where(eq(collections.id, id)).get()
}

export function isVisibleTo(id: string, profileId: string) {
  return visibleCollections(profileId).some(item => item.id === id)
}

function knownProfiles(ids: string[]) {
  if (!ids.length)
    return []

  return getDb()
    .select({ id: profiles.id })
    .from(profiles)
    .where(inArray(profiles.id, ids))
    .all()
    .map(row => row.id)
}

function isUniqueViolation(err: unknown) {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message)
}

function setHidden(id: string, hiddenFrom: string[]) {
  const db = getDb()

  db.delete(collectionHiddenProfiles)
    .where(eq(collectionHiddenProfiles.collectionId, id))
    .run()

  const known = knownProfiles([...new Set(hiddenFrom)])

  if (known.length) {
    db.insert(collectionHiddenProfiles)
      .values(known.map(profileId => ({ collectionId: id, profileId })))
      .run()
  }
}

export function createCollection(input: CollectionInput) {
  const name = input.name.normalize('NFC').trim()

  try {
    return getDb().transaction(() => {
      const row = getDb()
        .insert(collections)
        .values({
          name,
          nameKey: nameKeyOf(name),
          showOnHome: input.showOnHome ?? true,
        })
        .returning()
        .get()

      setHidden(row.id, input.hiddenFrom ?? [])

      return withCounts([row])[0]
    })
  }
  catch (err) {
    if (isUniqueViolation(err))
      throw new CollectionNameTakenError()

    throw err
  }
}

export function updateCollection(id: string, input: Partial<CollectionInput>) {
  const name = input.name?.normalize('NFC').trim()

  try {
    return getDb().transaction(() => {
      const row = getDb()
        .update(collections)
        .set({
          ...(name !== undefined && { name, nameKey: nameKeyOf(name) }),
          ...(input.showOnHome !== undefined && {
            showOnHome: input.showOnHome,
          }),
          updatedAt: new Date(),
        })
        .where(eq(collections.id, id))
        .returning()
        .get()

      if (!row)
        return undefined

      if (input.hiddenFrom)
        setHidden(id, input.hiddenFrom)

      return withCounts([row])[0]
    })
  }
  catch (err) {
    if (isUniqueViolation(err))
      throw new CollectionNameTakenError()

    throw err
  }
}

export function deleteCollection(id: string) {
  return (
    getDb().delete(collections).where(eq(collections.id, id)).run().changes > 0
  )
}

export function addToCollection(
  id: string,
  titleId: string,
  profileId?: string,
) {
  getDb()
    .insert(collectionTitles)
    .values({ collectionId: id, titleId, addedByProfileId: profileId ?? null })
    .onConflictDoNothing()
    .run()
}

export function removeFromCollection(id: string, titleId: string) {
  getDb()
    .delete(collectionTitles)
    .where(
      and(
        eq(collectionTitles.collectionId, id),
        eq(collectionTitles.titleId, titleId),
      ),
    )
    .run()
}

/** Тайтлы подборки, новые сверху */
export function collectionItems(id: string) {
  return getDb()
    .select({ titleId: collectionTitles.titleId, at: collectionTitles.addedAt })
    .from(collectionTitles)
    .where(eq(collectionTitles.collectionId, id))
    .orderBy(desc(collectionTitles.addedAt))
    .all()
}

/** В каких подборках лежит тайтл */
export function collectionsWith(titleId: string) {
  return new Set(
    getDb()
      .select({ id: collectionTitles.collectionId })
      .from(collectionTitles)
      .where(eq(collectionTitles.titleId, titleId))
      .all()
      .map(row => row.id),
  )
}
