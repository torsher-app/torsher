import type { DownloadedSubtitle } from '../../db/schema.ts'
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { libraryProbeKey, sameStoredMtime } from '../library/playedSource.ts'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import {
  downloadedSubtitles,
  subtitleJobs,
  subtitleOffsets,
} from '../../db/schema.ts'
import { getMediaFile } from '../library/files.ts'
import { folderWithLibrary } from '../library/folders.ts'
import { sidecarPath } from '../library/layout.ts'
import { convertSubtitle, MAX_SUBTITLE_BYTES } from './subtitles.ts'

const PRIVATE_SUBTITLE_LIMIT = 128 * 1024 * 1024
const STORAGE_ID
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function storageDir() {
  return join(config.dataDir, 'subtitles')
}

function subtitlePath(
  track: Pick<DownloadedSubtitle, 'id' | 'managedName' | 'mediaFileId'>,
) {
  if (!track.managedName)
    return join(storageDir(), `${track.id}.srt`)
  if (!track.mediaFileId || basename(track.managedName) !== track.managedName)
    return undefined
  const found = getMediaFile(track.mediaFileId)
  return found && folderWithLibrary(found.folder.id)?.library.managed
    ? join(dirname(found.path), track.managedName)
    : undefined
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function decodeSrt(bytes: Uint8Array, language: string | null) {
  const [first, second] = bytes
  if (first === 0xFF && second === 0xFE)
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes)
  if (first === 0xFE && second === 0xFF)
    return new TextDecoder('utf-16be', { fatal: true }).decode(bytes)

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  catch (error) {
    if (language !== 'rus' && language !== 'ru')
      throw error
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

export function downloadedSubtitleId(subtitle: DownloadedSubtitle) {
  return `m${subtitle.id}`
}

export function downloadedSubtitlesOf(sourceRevision: string, owner: boolean) {
  const tracks = getDb()
    .select()
    .from(downloadedSubtitles)
    .where(
      and(
        eq(downloadedSubtitles.sourceRevision, sourceRevision),
        owner ? undefined : eq(downloadedSubtitles.ownerOnly, false),
      ),
    )
    .all()
  return availableDownloadedSubtitles(tracks)
}

export async function downloadedSubtitleRevision(track: DownloadedSubtitle) {
  const path = subtitlePath(track)
  const info = path ? await lstat(path).catch(() => undefined) : undefined
  return info?.isFile() && info.size === track.bytes
    ? JSON.stringify([
        info.dev,
        info.ino,
        info.size,
        info.mtimeMs,
        info.ctimeMs,
      ])
    : undefined
}

export async function availableDownloadedSubtitles(
  tracks: DownloadedSubtitle[],
) {
  const present = await Promise.all(
    tracks.map(async track =>
      (await downloadedSubtitleRevision(track)) ? track : undefined,
    ),
  )
  return present.filter(track => track !== undefined)
}

/** Активная запись держит BEGIN IMMEDIATE от создания .tmp до COMMIT. */
function reconcileStorage(db: ReturnType<typeof getDb>, dir: string) {
  const known = new Set(
    db
      .select({ id: downloadedSubtitles.id })
      .from(downloadedSubtitles)
      .where(isNull(downloadedSubtitles.managedName))
      .all()
      .map(row => row.id),
  )
  const sizes = new Map<string, number>()

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile())
      continue

    const { name } = entry
    const path = join(dir, name)
    const staged
      = name.startsWith('.')
        && name.endsWith('.tmp')
        && STORAGE_ID.test(name.slice(1, -4))
    const id = name.endsWith('.srt') ? name.slice(0, -4) : ''
    const final = STORAGE_ID.test(id)
    if (staged || (final && !known.has(id))) {
      rmSync(path, { force: true })
    }
    else if (final) {
      const info = lstatSync(path, { throwIfNoEntry: false })
      if (info?.isFile())
        sizes.set(id, info.size)
    }
  }
  return sizes
}

export function reconcilePrivateSubtitleStorage() {
  const dir = storageDir()
  if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory())
    return
  const db = getDb()
  db.transaction(
    () => {
      const rows = db
        .select()
        .from(downloadedSubtitles)
        .where(
          and(
            isNull(downloadedSubtitles.managedName),
            isNotNull(downloadedSubtitles.mediaFileId),
          ),
        )
        .all()
      for (const track of rows) {
        const found = getMediaFile(track.mediaFileId!)
        if (!found || found.folder.status !== 'ok')
          continue
        const info = lstatSync(found.path, { throwIfNoEntry: false })
        if (
          info?.isFile()
          && found.file.inode === info.ino
          && found.file.size === info.size
          && sameStoredMtime(found.file.mtime, info.mtimeMs)
          && track.sourceRevision !== libraryProbeKey(found.file.id, info)
        ) {
          removeSubtitleRecord(track)
        }
      }
      reconcileStorage(db, dir)
    },
    { behavior: 'immediate' },
  )
}

interface SubtitleStorageOptions {
  provider?: NonNullable<DownloadedSubtitle['provider']>
  providerFile?: string
  hearingImpaired?: boolean
  library?: { id: string, path: string, managed: boolean }
  canPublish?: () => Promise<boolean>
  activeIds?: () => Set<string>
}

export class SubtitlePublicationCancelled extends Error {}
export class SubtitleArtifactConflict extends Error {}

export async function storedProviderSubtitle(
  sourceRevision: string,
  provider: NonNullable<DownloadedSubtitle['provider']>,
  file: string,
  ownerOnly: boolean,
) {
  const row = getDb()
    .select()
    .from(downloadedSubtitles)
    .where(
      and(
        eq(downloadedSubtitles.sourceRevision, sourceRevision),
        eq(downloadedSubtitles.provider, provider),
        eq(downloadedSubtitles.providerFile, file),
        eq(downloadedSubtitles.ownerOnly, ownerOnly),
      ),
    )
    .get()
  if (!row)
    return undefined
  const state = subtitleFileState(row)
  if (state === 'changed')
    throw new SubtitleArtifactConflict()
  return state === 'present' ? row : undefined
}

function writeExclusive(path: string, id: string, bytes: Uint8Array) {
  const temp = join(dirname(path), `.${id}.tmp`)
  // Незавершённая попытка с тем же ID. Параллельная запись держит BEGIN IMMEDIATE.
  rmSync(temp, { force: true })
  writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 })
  try {
    linkSync(temp, path)
  }
  finally {
    rmSync(temp, { force: true })
  }
}

export function ownedManagedSubtitleNames(mediaFileId: string) {
  const rows = getDb()
    .select({ name: downloadedSubtitles.managedName })
    .from(downloadedSubtitles)
    .where(
      and(
        eq(downloadedSubtitles.mediaFileId, mediaFileId),
        isNotNull(downloadedSubtitles.managedName),
      ),
    )
    .all()
  return new Set(rows.flatMap(row => (row.name ? [row.name] : [])))
}

function managedSubtitleName(
  library: NonNullable<SubtitleStorageOptions['library']>,
  input: { language: string | null, forced: boolean },
  hearingImpaired: boolean | undefined,
) {
  const existing = ownedManagedSubtitleNames(library.id)
  const tags = [
    input.language,
    input.forced ? 'forced' : null,
    hearingImpaired ? 'sdh' : null,
  ].filter(tag => tag !== null)
  for (let variant = 1; variant <= 100; variant++) {
    const target = sidecarPath(
      library.path,
      'srt',
      variant === 1 ? tags : [...tags, String(variant)],
    )
    const name = basename(target)
    if (!existing.has(name) && !lstatSync(target, { throwIfNoEntry: false }))
      return name
  }
  throw new Error('Subtitle sidecar names are exhausted')
}

function subtitleFileState(track: DownloadedSubtitle) {
  const path = subtitlePath(track)
  if (!path)
    return 'changed'
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (!info)
    return 'missing'
  if (
    !info.isFile()
    || track.bytes > MAX_SUBTITLE_BYTES
    || info.size !== track.bytes
  ) {
    return 'changed'
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const current = fstatSync(fd)
    if (
      current.ino !== info.ino
      || current.dev !== info.dev
      || current.size !== info.size
    ) {
      return 'changed'
    }
    const bytes = new Uint8Array(current.size)
    if (
      readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length
      || digest(bytes) !== track.sha256
    ) {
      return 'changed'
    }
  }
  finally {
    closeSync(fd)
  }
  return 'present'
}

function removeSubtitleFile(track: DownloadedSubtitle) {
  const state = subtitleFileState(track)
  if (state === 'present')
    rmSync(subtitlePath(track)!, { force: true })
  return state !== 'changed'
}

function removeSubtitleRecord(track: DownloadedSubtitle) {
  const db = getDb()
  db.delete(downloadedSubtitles)
    .where(eq(downloadedSubtitles.id, track.id))
    .run()
  db.delete(subtitleOffsets)
    .where(eq(subtitleOffsets.trackKey, downloadedSubtitleId(track)))
    .run()
}

function reconcileQuota(
  sizes: Map<string, number>,
  requested: number,
  active: Set<string>,
) {
  let used = [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0)
  if (used + requested <= PRIVATE_SUBTITLE_LIMIT)
    return
  const rows = getDb()
    .select()
    .from(downloadedSubtitles)
    .where(
      and(
        isNull(downloadedSubtitles.mediaFileId),
        isNotNull(downloadedSubtitles.provider),
      ),
    )
    .orderBy(downloadedSubtitles.lastUsedAt)
    .all()
  for (const track of rows) {
    const bytes = sizes.get(track.id)
    if (bytes && !active.has(track.id) && removeSubtitleFile(track)) {
      removeSubtitleRecord(track)
      used -= bytes
      if (used + requested <= PRIVATE_SUBTITLE_LIMIT)
        return
    }
  }
  throw new Error('Subtitle storage is full')
}

export async function registerDownloadedSubtitle(
  sourceRevision: string,
  input: Pick<
    DownloadedSubtitle,
    'language' | 'title' | 'forced' | 'ownerOnly'
  >,
  bytes: Uint8Array,
  options: SubtitleStorageOptions = {},
) {
  if (!bytes.length || bytes.length > MAX_SUBTITLE_BYTES)
    throw new Error('Invalid subtitle size')
  const text = decodeSrt(bytes, input.language)
  const payload = new TextEncoder().encode(text)
  if (payload.length > MAX_SUBTITLE_BYTES)
    throw new Error('Invalid subtitle size')
  const cues = await convertSubtitle(text, 'srt')
  if (!cues.some(cue => cue.end > cue.start && cue.text.trim()))
    throw new Error('No usable subtitle cues')

  const sha256 = digest(payload)
  const db = getDb()
  const dir = storageDir()
  const managed
    = options.provider === 'opensubtitles' && options.library?.managed
      ? options.library
      : undefined
  if (!managed)
    await mkdir(dir, { recursive: true, mode: 0o700 })
  if (options.canPublish && !(await options.canPublish()))
    throw new SubtitlePublicationCancelled()

  const track = db.transaction(
    () => {
      const duplicate = db
        .select()
        .from(downloadedSubtitles)
        .where(
          and(
            eq(downloadedSubtitles.sourceRevision, sourceRevision),
            eq(downloadedSubtitles.ownerOnly, input.ownerOnly),
            or(
              options.provider && options.providerFile
                ? and(
                    eq(downloadedSubtitles.provider, options.provider),
                    eq(downloadedSubtitles.providerFile, options.providerFile),
                  )
                : undefined,
              and(
                eq(downloadedSubtitles.sha256, sha256),
                input.language === null
                  ? isNull(downloadedSubtitles.language)
                  : eq(downloadedSubtitles.language, input.language),
                eq(downloadedSubtitles.forced, input.forced),
              ),
            ),
          ),
        )
        .get()
      if (
        duplicate
        && (duplicate.sha256 !== sha256
          || subtitleFileState(duplicate) === 'changed')
      ) {
        throw new SubtitleArtifactConflict()
      }

      const row = duplicate ?? {
        ...input,
        id: randomUUID(),
        bytes: payload.length,
        sourceRevision,
        sha256,
        mediaFileId: options.library?.id ?? null,
        provider: options.provider ?? null,
        providerFile: options.providerFile ?? null,
        managedName: managed
          ? managedSubtitleName(managed, input, options.hearingImpaired)
          : null,
        hearingImpaired: options.hearingImpaired ?? null,
        lastUsedAt: new Date(),
      }
      const path = subtitlePath(row)
      if (!path)
        throw new SubtitlePublicationCancelled()
      if (!row.managedName) {
        const sizes = reconcileStorage(db, dir)
        if (!sizes.has(row.id)) {
          reconcileQuota(
            sizes,
            payload.length,
            options.activeIds?.() ?? new Set(),
          )
          writeExclusive(path, row.id, payload)
        }
      }
      if (!duplicate)
        db.insert(downloadedSubtitles).values(row).run()
      return { row, created: !duplicate }
    },
    { behavior: 'immediate' },
  )

  // Резервируем имя sidecar в БД до публикации. После сбоя уже
  // размещённый файл не появляется повторно как обычный незарегистрированный.
  if (track.row.managedName) {
    const published = db.transaction(
      () => {
        const path = subtitlePath(track.row)
        if (!path || !managed || dirname(path) !== dirname(managed.path))
          throw new SubtitlePublicationCancelled()
        const state = subtitleFileState(track.row)
        if (state === 'changed' || (track.created && state === 'present')) {
          if (track.created)
            removeSubtitleRecord(track.row)
          return false
        }
        if (state === 'missing')
          writeExclusive(path, track.row.id, payload)
        return true
      },
      { behavior: 'immediate' },
    )
    if (!published)
      throw new SubtitleArtifactConflict()
  }
  return track.row
}

export function removeDownloadedSubtitle(
  track: DownloadedSubtitle,
  suppress: boolean,
) {
  const db = getDb()
  db.transaction(
    () => {
      removeSubtitleFile(track)
      removeSubtitleRecord(track)
      if (suppress && track.mediaFileId && track.language) {
        db.insert(subtitleJobs)
          .values({
            mediaFileId: track.mediaFileId,
            sourceRevision: track.sourceRevision,
            language: track.language,
            state: 'suppressed',
            nextAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              subtitleJobs.mediaFileId,
              subtitleJobs.sourceRevision,
              subtitleJobs.language,
            ],
            set: { state: 'suppressed' },
          })
          .run()
      }
    },
    { behavior: 'immediate' },
  )
}

export function removeManagedSubtitlesForReplacement(
  mediaFileId: string,
  keepRevision?: string,
) {
  const db = getDb()
  const rows = db
    .select()
    .from(downloadedSubtitles)
    .where(eq(downloadedSubtitles.mediaFileId, mediaFileId))
    .all()
    .filter(track => track.sourceRevision !== keepRevision)
  db.transaction(
    () => {
      for (const track of rows) {
        const removed = removeSubtitleFile(track)
        if (removed || !track.managedName)
          removeSubtitleRecord(track)
      }
    },
    { behavior: 'immediate' },
  )
}

/** Привязка переезжает только по подтверждённой квитанции Storage Move. */
export function rebindMovedSubtitles(
  mediaFileId: string,
  oldRevision: string,
  newRevision: string,
  movedNames: Set<string>,
) {
  if (oldRevision === newRevision)
    return
  const db = getDb()
  const rows = db
    .select()
    .from(downloadedSubtitles)
    .where(
      and(
        eq(downloadedSubtitles.mediaFileId, mediaFileId),
        eq(downloadedSubtitles.sourceRevision, oldRevision),
      ),
    )
    .all()
  for (const track of rows) {
    if (track.managedName && !movedNames.has(track.managedName))
      continue
    const key = downloadedSubtitleId(track)
    db.update(downloadedSubtitles)
      .set({ sourceRevision: newRevision })
      .where(eq(downloadedSubtitles.id, track.id))
      .run()
    const offsets = db
      .select()
      .from(subtitleOffsets)
      .where(
        and(
          eq(subtitleOffsets.sourceRevision, oldRevision),
          eq(subtitleOffsets.trackKey, key),
        ),
      )
      .all()
    if (offsets.length) {
      db.insert(subtitleOffsets)
        .values(
          offsets.map(offset => ({
            ...offset,
            sourceRevision: newRevision,
          })),
        )
        .onConflictDoNothing()
        .run()
      db.delete(subtitleOffsets)
        .where(
          and(
            eq(subtitleOffsets.sourceRevision, oldRevision),
            eq(subtitleOffsets.trackKey, key),
          ),
        )
        .run()
    }
  }
  const oldJobs = and(
    eq(subtitleJobs.mediaFileId, mediaFileId),
    eq(subtitleJobs.sourceRevision, oldRevision),
  )
  const jobs = db.select().from(subtitleJobs).where(oldJobs).all()
  if (jobs.length) {
    db.insert(subtitleJobs)
      .values(jobs.map(job => ({ ...job, sourceRevision: newRevision })))
      .onConflictDoNothing()
      .run()
    db.delete(subtitleJobs).where(oldJobs).run()
  }
}

export function touchDownloadedSubtitle(track: DownloadedSubtitle) {
  if (
    !track.mediaFileId
    && (!track.lastUsedAt || Date.now() - track.lastUsedAt.getTime() > 60 * 60_000)
  ) {
    track.lastUsedAt = new Date()
    getDb()
      .update(downloadedSubtitles)
      .set({ lastUsedAt: track.lastUsedAt })
      .where(eq(downloadedSubtitles.id, track.id))
      .run()
  }
}

export function pruneTorrentSubtitles(active: Set<string>) {
  const rows = getDb()
    .select()
    .from(downloadedSubtitles)
    .where(
      and(
        isNotNull(downloadedSubtitles.provider),
        isNull(downloadedSubtitles.mediaFileId),
        lt(
          downloadedSubtitles.lastUsedAt,
          new Date(Date.now() - 30 * 24 * 60 * 60_000),
        ),
      ),
    )
    .all()
  for (const track of rows) {
    if (!active.has(track.id))
      removeDownloadedSubtitle(track, false)
  }
}

export async function loadDownloadedSubtitle(track: DownloadedSubtitle) {
  const path = subtitlePath(track)
  if (!path)
    throw new Error('Subtitle file is unavailable')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)

  try {
    const info = await handle.stat()
    if (
      !info.isFile()
      || info.size !== track.bytes
      || info.size > MAX_SUBTITLE_BYTES
    ) {
      throw new Error('Invalid subtitle file')
    }

    const bytes = new Uint8Array(info.size)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== bytes.length || digest(bytes) !== track.sha256)
      throw new Error('Subtitle file changed')

    return await convertSubtitle(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      'srt',
    )
  }
  finally {
    await handle.close()
  }
}

export function subtitleOffsetsOf(profileId: string, sourceRevision: string) {
  return new Map(
    getDb()
      .select({
        key: subtitleOffsets.trackKey,
        value: subtitleOffsets.offsetMs,
      })
      .from(subtitleOffsets)
      .where(
        and(
          eq(subtitleOffsets.profileId, profileId),
          eq(subtitleOffsets.sourceRevision, sourceRevision),
        ),
      )
      .all()
      .map(row => [row.key, row.value]),
  )
}

export function saveSubtitleOffset(
  profileId: string,
  sourceRevision: string,
  trackKey: string,
  offsetMs: number,
) {
  const db = getDb()
  if (offsetMs === 0) {
    db.delete(subtitleOffsets)
      .where(
        and(
          eq(subtitleOffsets.profileId, profileId),
          eq(subtitleOffsets.sourceRevision, sourceRevision),
          eq(subtitleOffsets.trackKey, trackKey),
        ),
      )
      .run()
    return
  }

  db.insert(subtitleOffsets)
    .values({ profileId, sourceRevision, trackKey, offsetMs })
    .onConflictDoUpdate({
      target: [
        subtitleOffsets.profileId,
        subtitleOffsets.sourceRevision,
        subtitleOffsets.trackKey,
      ],
      set: { offsetMs },
    })
    .run()
}
