import type { ExportDocument, ExportSettings } from './document.ts'
import type { ConflictPolicy } from './merge.ts'
import type { PasswordKey } from './passwords.ts'
import type { ProfileMergeCounts, ProfileRows } from './profileData.ts'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { titleKey } from '@torsher/release-parser'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  collectionHiddenProfiles,
  collections,
  collectionTitles,
  indexerManagers,
  indexers,
  libraries,
  libraryFolders,
  libraryHiddenProfiles,
  netRoutes,
  notificationChannelKinds,
  notificationChannels,
  profiles,
  titleAliases,
  titleVoices,
} from '../../db/schema.ts'
import { createBackupNow } from '../backups/index.ts'
import { scanFolder } from '../library/scan.ts'
import { logFor } from '../logs/index.ts'
import { routesChanged } from '../net/index.ts'
import { providerOf } from '../notifications/channels/index.ts'
import { encryptSecret } from '../secrets/index.ts'
import { saveTmdbKey, tmdbKeySource } from '../tmdb/credentials.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { addLibraryDecisions } from './libraryMatches.ts'
import {
  decryptWithPassword,
  passwordKeyOf,
  verifyPasswordCheck,
} from './passwords.ts'
import { applyProfileMerge, planProfileMerge } from './profileData.ts'

// Предпросмотр ждёт решения владельца, потом забывается
const JOB_TTL_MS = 30 * 60 * 1000

export class ServerImportNotFoundError extends Error {}

/** Копия перед импортом: тесты на базе в памяти её подменяют */
export const serverImportDeps = {
  backup: async () =>
    (await createBackupNow('pre-import')).name as string | null,
}

export type ProfileTarget
  = { kind: 'existing', id: string } | { kind: 'new' } | { kind: 'skip' }

export type SecretsState = 'none' | 'locked' | 'wrong' | 'ok'

interface ServerImportJob {
  token: string
  document: ExportDocument
  key?: PasswordKey
  secrets: SecretsState
  createdAt: number
}

const jobs = new Map<string, ServerImportJob>()

function forgetStale(now = Date.now()) {
  for (const [token, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS)
      jobs.delete(token)
  }
}

function nameKeyOf(name: string) {
  return name.normalize('NFC').trim().toLocaleLowerCase()
}

function rowsOf(document: ExportDocument, key: string): ProfileRows {
  return {
    progress: document.progress.filter(row => row.profile === key),
    mine: document.mine.filter(row => row.profile === key),
  }
}

function secretsOf(document: ExportDocument, password?: string) {
  if (!document.encryption)
    return { secrets: 'none' as const }

  if (!password)
    return { secrets: 'locked' as const }

  const key = passwordKeyOf(password, document.encryption.salt)

  try {
    if (verifyPasswordCheck(key, document.encryption.check))
      return { secrets: 'ok' as const, key }
  }
  catch {}

  return { secrets: 'wrong' as const }
}

/** Профили файла → профили сервера по имени, остальные создаются */
function suggestTargets(document: ExportDocument) {
  const existing = new Map(
    getDb()
      .select({ id: profiles.id, name: profiles.name })
      .from(profiles)
      .all()
      .map(row => [nameKeyOf(row.name), row.id]),
  )

  return new Map(
    document.profiles.map((profile) => {
      const id = existing.get(nameKeyOf(profile.name))

      return [
        profile.key,
        id ? { kind: 'existing' as const, id } : { kind: 'new' as const },
      ]
    }),
  )
}

function settingsPreview(settings: ExportSettings | undefined) {
  if (!settings)
    return undefined

  const db = getDb()
  const routes = new Set(
    db
      .select({ match: netRoutes.match })
      .from(netRoutes)
      .all()
      .map(row => row.match),
  )
  const managers = new Set(
    db
      .select({ kind: indexerManagers.kind, url: indexerManagers.url })
      .from(indexerManagers)
      .all()
      .map(row => `${row.kind} ${row.url}`),
  )
  const indexerUrls = new Set(
    db
      .select({ url: indexers.url })
      .from(indexers)
      .all()
      .map(row => row.url),
  )
  const channels = new Set(
    db
      .select({
        kind: notificationChannels.kind,
        name: notificationChannels.name,
      })
      .from(notificationChannels)
      .all()
      .map(row => `${row.kind} ${nameKeyOf(row.name)}`),
  )
  const count = <T>(items: T[] | undefined, known: (item: T) => boolean) => {
    const all = items ?? []
    const existing = all.filter(known).length

    return { new: all.length - existing, existing }
  }

  return {
    routes: count(settings.routes, row => routes.has(row.match)),
    managers: count(settings.managers, row =>
      managers.has(`${row.kind} ${row.url}`)),
    indexers: count(
      settings.indexers?.filter(row => !row.manager),
      row => indexerUrls.has(row.url),
    ),
    channels: count(settings.channels, row =>
      channels.has(`${row.kind} ${nameKeyOf(row.name)}`)),
    tmdbKey: !!settings.tmdbKey && tmdbKeySource() !== 'custom',
  }
}

async function exists(path: string) {
  try {
    await access(path)

    return true
  }
  catch {
    return false
  }
}

async function librariesPreview(document: ExportDocument) {
  if (!document.libraries)
    return undefined

  const known = new Set(
    getDb()
      .select({ path: libraryFolders.path })
      .from(libraryFolders)
      .all()
      .map(row => row.path),
  )
  const folders = document.libraries.flatMap(library => library.folders)
  const fresh = folders.filter(folder => !known.has(folder.path))
  const missing: string[] = []

  for (const folder of fresh) {
    if (!(await exists(folder.path)))
      missing.push(folder.path)
  }

  return {
    folders: { new: fresh.length, existing: folders.length - fresh.length },
    missingFolders: missing,
    decisions: document.libraries.reduce(
      (sum, library) => sum + library.files.length,
      0,
    ),
  }
}

function collectionsPreview(document: ExportDocument) {
  if (!document.collections)
    return undefined

  const known = new Set(
    getDb()
      .select({ nameKey: collections.nameKey })
      .from(collections)
      .all()
      .map(row => row.nameKey),
  )
  const merged = document.collections.filter(row =>
    known.has(nameKeyOf(row.name)),
  ).length

  return { new: document.collections.length - merged, merged }
}

export interface ServerImportPreview {
  token: string
  exportedAt: string
  version: string
  profiles: Array<{
    key: string
    name: string
    target: ProfileTarget
    counts: ProfileMergeCounts
  }>
  collections?: { new: number, merged: number }
  voices: number
  aliases: number
  libraries?: Awaited<ReturnType<typeof librariesPreview>>
  settings?: ReturnType<typeof settingsPreview>
  secrets: SecretsState
}

/**
 * Разбор файла экспорта сервера и сводка без записи в базу. Профили файла
 * сопоставляются с профилями сервера по имени; счётчики — для сопоставления
 * по умолчанию.
 */
export async function previewServerImport(
  document: ExportDocument,
  password?: string,
): Promise<ServerImportPreview> {
  forgetStale()

  const { secrets, key } = secretsOf(document, password) as {
    secrets: SecretsState
    key?: PasswordKey
  }
  const targets = suggestTargets(document)
  const token = randomUUID()

  jobs.set(token, { token, document, key, secrets, createdAt: Date.now() })

  return {
    token,
    exportedAt: document.exportedAt,
    version: document.torsher.version,
    profiles: document.profiles.map((profile) => {
      const target = targets.get(profile.key)!

      return {
        key: profile.key,
        name: profile.name,
        target,
        counts: planProfileMerge(
          target.kind === 'existing' ? target.id : null,
          rowsOf(document, profile.key),
          'newer',
        ).counts,
      }
    }),
    collections: collectionsPreview(document),
    voices: document.voices?.length ?? 0,
    aliases: document.aliases?.length ?? 0,
    libraries: await librariesPreview(document),
    settings: settingsPreview(document.settings),
    secrets,
  }
}

export interface ServerImportInput {
  // Ключ профиля в файле → куда: ID профиля сервера, `new` или `skip`
  mapping: Record<string, string>
  conflicts: ConflictPolicy
  // Команда в контейнере не ждёт скана: папки просканирует сервер
  scan?: boolean
}

export interface ServerImportResult {
  // Копия `pre-import`: «Отменить импорт» восстанавливает её
  backup: string | null
  profiles: { created: number, merged: number, changed: number }
  collections: number
  settings: number
  folders: number
  decisions: number
  skipped: number
}

function targetOf(value: string | undefined): ProfileTarget {
  if (!value || value === 'new')
    return { kind: 'new' }

  if (value === 'skip')
    return { kind: 'skip' }

  return { kind: 'existing', id: value }
}

interface SecretReader {
  // Шифртекст от пароля → шифртекст ключа этого сервера; без пароля — null
  read: (value: string | null | undefined) => string | null
  plain: (value: string | null | undefined) => string | null
}

function secretReader(key: PasswordKey | undefined): SecretReader {
  const plain = (value: string | null | undefined) => {
    if (!value || !key)
      return null

    try {
      return decryptWithPassword(key, value)
    }
    catch {
      return null
    }
  }

  return {
    plain,
    read: (value) => {
      const text = plain(value)

      return text === null ? null : encryptSecret(text)
    },
  }
}

function nextPosition(table: typeof netRoutes) {
  const last = getDb()
    .select({ position: table.position })
    .from(table)
    .orderBy(desc(table.position))
    .get()

  return (last?.position ?? -1) + 1
}

function importRoutes(settings: ExportSettings, secrets: SecretReader) {
  const db = getDb()
  const known = new Set(
    db
      .select({ match: netRoutes.match })
      .from(netRoutes)
      .all()
      .map(row => row.match),
  )
  let position = nextPosition(netRoutes)
  let added = 0

  for (const route of settings.routes ?? []) {
    if (known.has(route.match))
      continue

    db.insert(netRoutes)
      .values({
        match: route.match,
        via: route.via,
        proxyAddress: route.proxyAddress,
        proxyUsername: secrets.read(route.proxyUsername),
        proxyPassword: secrets.read(route.proxyPassword),
        dns: route.dns,
        dohUrl: route.dohUrl,
        position: route.match === '*' ? 0 : position++,
      })
      .run()
    known.add(route.match)
    added++
  }

  return added
}

function importIndexers(settings: ExportSettings, secrets: SecretReader) {
  const db = getDb()
  const managerIds = new Map<string, string>()
  let added = 0

  for (const manager of settings.managers ?? []) {
    const existing = db
      .select({ id: indexerManagers.id })
      .from(indexerManagers)
      .where(
        and(
          eq(indexerManagers.kind, manager.kind),
          eq(indexerManagers.url, manager.url),
        ),
      )
      .get()

    // Индексаторы известного менеджера придут его синхронизацией
    if (existing)
      continue

    const row = db
      .insert(indexerManagers)
      .values({
        kind: manager.kind,
        url: manager.url,
        // Ключа нет — строка не расшифруется, и панель попросит его заново
        apiKey: secrets.read(manager.apiKey) ?? '',
      })
      .returning({ id: indexerManagers.id })
      .get()

    managerIds.set(manager.key, row.id)
    added++
  }

  const urls = new Set(
    db
      .select({ url: indexers.url })
      .from(indexers)
      .all()
      .map(row => row.url),
  )

  for (const indexer of settings.indexers ?? []) {
    const managerId = indexer.manager ? managerIds.get(indexer.manager) : null

    if (indexer.manager && !managerId)
      continue

    if (!indexer.manager && urls.has(indexer.url))
      continue

    db.insert(indexers)
      .values({
        name: indexer.name,
        url: indexer.url,
        apiKey: secrets.read(indexer.apiKey),
        enabled: indexer.enabled,
        managerId: managerId ?? null,
        externalId: managerId ? indexer.externalId : null,
      })
      .run()
    urls.add(indexer.url)
    added++
  }

  return added
}

function importChannels(settings: ExportSettings, secrets: SecretReader) {
  const db = getDb()
  const known = new Set(
    db
      .select({
        kind: notificationChannels.kind,
        name: notificationChannels.name,
      })
      .from(notificationChannels)
      .all()
      .map(row => `${row.kind} ${nameKeyOf(row.name)}`),
  )
  let added = 0

  for (const channel of settings.channels ?? []) {
    const provider = providerOf(channel.kind)
    const kind = notificationChannelKinds.find(item => item === channel.kind)

    if (!provider || !kind || known.has(`${kind} ${nameKeyOf(channel.name)}`))
      continue

    const config: Record<string, unknown> = {}
    let complete = true

    for (const [field, value] of Object.entries(channel.config)) {
      if (!provider.secretFields.includes(field)) {
        config[field] = value
        continue
      }

      const secret = secrets.read(typeof value === 'string' ? value : null)

      if (secret)
        config[field] = secret
      else complete = false
    }

    complete &&= provider.secretFields.every(
      field => !(field in channel.config) || field in config,
    )

    db.insert(notificationChannels)
      .values({
        kind,
        name: channel.name,
        // Без секрета канал не доставит: владелец включит его, введя ключ
        enabled: channel.enabled && complete,
        language: channel.language,
        panelUrl: channel.panelUrl,
        config,
        events: channel.events,
        includeWarnings: channel.includeWarnings,
        notifyResolved: channel.notifyResolved,
      })
      .run()
    known.add(`${kind} ${nameKeyOf(channel.name)}`)
    added++
  }

  return added
}

function importCollections(
  document: ExportDocument,
  profileIds: Map<string, string>,
) {
  const db = getDb()
  let touched = 0

  for (const item of document.collections ?? []) {
    const nameKey = nameKeyOf(item.name)
    let row = db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.nameKey, nameKey))
      .get()

    if (!row) {
      row = db
        .insert(collections)
        .values({
          name: item.name.trim(),
          nameKey,
          showOnHome: item.showOnHome,
        })
        .returning({ id: collections.id })
        .get()

      for (const key of item.hiddenFrom) {
        const profileId = profileIds.get(key)

        if (profileId) {
          db.insert(collectionHiddenProfiles)
            .values({ collectionId: row.id, profileId })
            .onConflictDoNothing()
            .run()
        }
      }
    }

    for (const title of item.titles) {
      if (!parseCatalogId(title.title))
        continue

      db.insert(collectionTitles)
        .values({
          collectionId: row.id,
          titleId: title.title,
          addedAt: new Date(title.addedAt),
          addedByProfileId: title.addedBy
            ? (profileIds.get(title.addedBy) ?? null)
            : null,
        })
        .onConflictDoNothing()
        .run()
    }

    touched++
  }

  return touched
}

function importVoices(document: ExportDocument) {
  const db = getDb()

  for (const voice of document.voices ?? []) {
    const updatedAt = new Date(voice.updatedAt)

    db.insert(titleVoices)
      .values({
        titleId: voice.title,
        season: voice.season,
        studio: voice.studio,
        type: voice.type,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [titleVoices.titleId, titleVoices.season],
        set: { studio: voice.studio, type: voice.type, updatedAt },
        setWhere: sql`${titleVoices.updatedAt} < ${updatedAt.getTime()}`,
      })
      .run()
  }
}

function importAliases(document: ExportDocument, now: Date) {
  for (const alias of document.aliases ?? []) {
    getDb()
      .insert(titleAliases)
      .values({
        titleId: alias.title,
        value: alias.value,
        normalized: titleKey(alias.value),
        lang: alias.lang,
        kind: 'user',
        syncedAt: now,
      })
      .onConflictDoNothing()
      .run()
  }
}

/** Библиотеки и папки, которых на сервере нет; ID новых папок — для скана */
function importLibraries(
  document: ExportDocument,
  profileIds: Map<string, string>,
) {
  const db = getDb()
  const known = new Map(
    db
      .select({
        path: libraryFolders.path,
        libraryId: libraryFolders.libraryId,
      })
      .from(libraryFolders)
      .all()
      .map(row => [row.path, row.libraryId]),
  )
  const added: string[] = []

  for (const library of document.libraries ?? []) {
    const existingId = library.folders
      .map(folder => known.get(folder.path))
      .find(Boolean)
    let libraryId = existingId

    if (!libraryId) {
      libraryId = db
        .insert(libraries)
        .values({
          kind: library.kind,
          name: library.name,
          exclude: library.exclude,
          watch: library.watch,
        })
        .returning({ id: libraries.id })
        .get()
        .id

      for (const key of library.hiddenFrom) {
        const profileId = profileIds.get(key)

        if (profileId) {
          db.insert(libraryHiddenProfiles)
            .values({ libraryId, profileId })
            .onConflictDoNothing()
            .run()
        }
      }
    }

    for (const folder of library.folders) {
      if (known.has(folder.path))
        continue

      const row = db
        .insert(libraryFolders)
        .values({
          libraryId,
          path: folder.path,
          hint: library.kind === 'video' ? folder.hint : 'auto',
          status: 'scanning',
        })
        .returning({ id: libraryFolders.id })
        .get()

      known.set(folder.path, libraryId)
      added.push(row.id)
    }
  }

  return added
}

function createProfileFrom(
  profile: ExportDocument['profiles'][number],
  position: number,
) {
  return getDb()
    .insert(profiles)
    .values({
      name: profile.name,
      color: profile.color,
      language: profile.language,
      ageLimit: profile.ageLimit,
      posterRatings: profile.posterRatings,
      player: profile.player,
      position,
    })
    .returning({ id: profiles.id })
    .get()
    .id
}

/**
 * Применяет импорт: копия `pre-import`, затем всё одной транзакцией.
 * Ошибка внутри — откат целиком; после — скан новых папок и решения о
 * файлах, которых ещё нет.
 */
export async function applyServerImport(
  token: string,
  input: ServerImportInput,
): Promise<ServerImportResult> {
  forgetStale()

  const job = jobs.get(token)

  if (!job)
    throw new ServerImportNotFoundError()

  const { document } = job
  // Копия не удалась — предпросмотр остаётся: владелец повторит, освободив место
  const backup = await serverImportDeps.backup()

  jobs.delete(token)
  const secrets = secretReader(job.key)
  const now = new Date()
  const db = getDb()
  const result: ServerImportResult = {
    backup,
    profiles: { created: 0, merged: 0, changed: 0 },
    collections: 0,
    settings: 0,
    folders: 0,
    decisions: 0,
    skipped: 0,
  }
  let newFolders: string[] = []

  db.transaction(() => {
    const profileIds = new Map<string, string>()
    const existing = new Set(
      db
        .select({ id: profiles.id })
        .from(profiles)
        .all()
        .map(row => row.id),
    )
    let position
      = (db
        .select({ position: profiles.position })
        .from(profiles)
        .orderBy(desc(profiles.position))
        .get()
        ?.position ?? -1) + 1

    for (const profile of document.profiles) {
      const target = targetOf(input.mapping[profile.key])

      if (target.kind === 'skip')
        continue

      let id: string

      if (target.kind === 'existing' && existing.has(target.id)) {
        id = target.id
        result.profiles.merged++
      }
      else {
        id = createProfileFrom(profile, position++)
        result.profiles.created++
      }

      profileIds.set(profile.key, id)

      const plan = planProfileMerge(
        id,
        rowsOf(document, profile.key),
        input.conflicts,
        now,
      )

      result.profiles.changed += applyProfileMerge(id, plan, now).length
      result.skipped += plan.counts.skipped
    }

    result.collections = importCollections(document, profileIds)
    importVoices(document)
    importAliases(document, now)
    newFolders = importLibraries(document, profileIds)
    result.folders = newFolders.length

    if (document.settings) {
      result.settings
        = importRoutes(document.settings, secrets)
          + importIndexers(document.settings, secrets)
          + importChannels(document.settings, secrets)
    }
  })

  if (document.settings?.routes?.length)
    routesChanged()

  const tmdbKey = secrets.plain(document.settings?.tmdbKey)

  if (tmdbKey && tmdbKeySource() !== 'custom') {
    saveTmdbKey(tmdbKey)
    result.settings++
  }

  result.decisions = addLibraryDecisions(
    (document.libraries ?? []).flatMap(library => library.files),
  )

  if (input.scan !== false) {
    for (const id of newFolders) void scanFolder(id)
  }

  logFor('backups').info({ ...result }, 'Server data imported')

  return result
}

/** Для тестов: предпросмотры живут в памяти процесса */
export function resetServerImports() {
  jobs.clear()
}
