import { isVideoFile } from '../torrents/media.ts'
import { getTorrentSettings } from '../torrents/settings.ts'
import {
  executionEnabled,
  executorAvailable,
  maintenanceNextRunAt,
} from './executor.ts'
import { durableMaintenance } from './durable.ts'
import { restoreHeld } from './restore.ts'
import { externalFenceList, maintenanceOperationList } from './status.ts'
import {
  assertMaintenancePolicyChange,
  externalMaintenanceFences,
  maintenancePathKeys,
} from './admission.ts'
import { verifyOwnedFile } from './identity.ts'
import type { CandidateGroup, Reason, Rule } from './evaluate.ts'
import { basename, join } from 'node:path'
import { and, eq, isNotNull, notInArray, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  follows,
  libraries,
  libraryFolders,
  maintenanceFiles,
  maintenanceGroups,
  maintenanceOperations,
  maintenanceRules,
  maintenanceSuppressions,
  mediaFiles,
  profiles,
  profileTitles,
  storageMoves,
  titleProgress,
  torrents,
  trackedTopics,
} from '../../db/schema.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import { playbackResources } from '../media/sessions.ts'
import { evaluateMaintenance } from './evaluate.ts'
import { episodesOf, ownedIdentity } from './provenance.ts'

export function rosterFingerprint(ids: string[]) {
  return JSON.stringify([...new Set(ids)].sort())
}

export const DEFAULT_RULE = 'default'
type StoredRule = Rule & { revision: number, rosterFingerprint: string }
function defaultPolicy() {
  return getSetting<StoredRule>('maintenanceDefaultRule')
}
function titlePolicy(titleId: string) {
  return getDb()
    .select()
    .from(maintenanceRules)
    .where(eq(maintenanceRules.titleId, titleId))
    .get()
}
export function policyFacts(titleId: string) {
  const local = titlePolicy(titleId)
  if (local && !local.inherits) {
    // Старые операции подписаны снимком правила до появления колонки inherits.
    const { inherits: _inherits, ...original } = local
    return original
  }
  return {
    localRevision: local?.revision ?? 0,
    common: defaultPolicy() ?? null,
  }
}

export function maintenanceConfig(titleId: string) {
  const roster = getDb()
    .select({ id: profiles.id, name: profiles.name })
    .from(profiles)
    .all()
  const local = titleId === DEFAULT_RULE ? undefined : titlePolicy(titleId)
  const inherited = titleId !== DEFAULT_RULE && (!local || local.inherits)
  const row = local && !local.inherits ? local : defaultPolicy()
  return {
    inherited,
    rule: {
      titleId,
      revision:
        (titleId === DEFAULT_RULE ? row?.revision : local?.revision) ?? 0,
      enabled: row?.enabled ?? false,
      days: row?.days ?? 30,
      keepLast: titleId.startsWith('tmdb:movie:')
        ? null
        : (row?.keepLast ?? null),
      profileIds: row?.profileIds ?? roster.map(item => item.id),
      rosterChanged:
        !!row
        && row.rosterFingerprint
        !== rosterFingerprint(roster.map(item => item.id)),
    },
    profiles: roster,
    executorAvailable: executorAvailable(),
  }
}

export function validRule(titleId: string, rule: Rule) {
  const roster = getDb()
    .select({ id: profiles.id })
    .from(profiles)
    .all()
    .map(row => row.id)
  return (
    (!titleId.startsWith('tmdb:movie:') || rule.keepLast === null)
    && rule.profileIds.length > 0
    && new Set(rule.profileIds).size === rule.profileIds.length
    && rule.profileIds.every(id => roster.includes(id))
  )
}

export function saveMaintenanceConfig(
  titleId: string,
  rule: Rule,
  expectedRevision: number,
) {
  assertMaintenancePolicyChange(
    titleId === DEFAULT_RULE ? { global: true } : { titleId },
  )

  const db = getDb()
  return durableMaintenance(() => {
    const current = maintenanceConfig(titleId)
    if (current.rule.revision !== expectedRevision)
      return undefined
    const values = {
      ...rule,
      revision: expectedRevision + 1,
      rosterFingerprint: rosterFingerprint(
        current.profiles.map(item => item.id),
      ),
    }
    if (titleId === DEFAULT_RULE) {
      setSetting('maintenanceDefaultRule', values)
      const overrides = db
        .select({ id: maintenanceRules.titleId })
        .from(maintenanceRules)
        .where(eq(maintenanceRules.inherits, false))
      db.update(maintenanceGroups)
        .set({ eligibleSince: null, eligibilityFingerprint: null })
        .where(notInArray(maintenanceGroups.titleId, overrides))
        .run()
    }
    else {
      const override = { ...values, inherits: false }
      db.insert(maintenanceRules)
        .values({ titleId, ...override })
        .onConflictDoUpdate({ target: maintenanceRules.titleId, set: override })
        .run()
      db.update(maintenanceGroups)
        .set({ eligibleSince: null, eligibilityFingerprint: null })
        .where(eq(maintenanceGroups.titleId, titleId))
        .run()
    }
    return maintenanceConfig(titleId)
  })
}

export function inheritMaintenanceConfig(
  titleId: string,
  revision: number,
  defaultRevision: number,
) {
  assertMaintenancePolicyChange({ titleId })
  const db = getDb()
  return durableMaintenance(() => {
    const local = titlePolicy(titleId)
    if (
      !local
      || local.inherits
      || local.revision !== revision
      || (defaultPolicy()?.revision ?? 0) !== defaultRevision
    ) {
      return undefined
    }
    // Оставляем ревизию: старая открытая форма не должна перезаписать заново созданное исключение.
    db.update(maintenanceRules)
      .set({ inherits: true, revision: revision + 1 })
      .where(eq(maintenanceRules.titleId, titleId))
      .run()
    db.update(maintenanceGroups)
      .set({ eligibleSince: null, eligibilityFingerprint: null })
      .where(eq(maintenanceGroups.titleId, titleId))
      .run()
    return maintenanceConfig(titleId)
  })
}

export function protectGroup(
  id: string,
  protectedValue: boolean,
  expectedRevision: number,
) {
  assertMaintenancePolicyChange({ groupId: id })

  return getDb()
    .update(maintenanceGroups)
    .set({
      manualProtection: protectedValue,
      revision: sql`${maintenanceGroups.revision} + 1`,
      eligibleSince: null,
      eligibilityFingerprint: null,
    })
    .where(
      and(
        eq(maintenanceGroups.id, id),
        eq(maintenanceGroups.revision, expectedRevision),
      ),
    )
    .returning({
      id: maintenanceGroups.id,
      revision: maintenanceGroups.revision,
    })
    .get()
}

export function maintenanceStatus() {
  const db = getDb()
  const roster = rosterFingerprint(
    db
      .select({ id: profiles.id })
      .from(profiles)
      .all()
      .map(profile => profile.id),
  )
  const rules = db
    .select()
    .from(maintenanceRules)
    .where(eq(maintenanceRules.inherits, false))
    .all()
    .map(rule => ({
      titleId: rule.titleId,
      enabled: rule.enabled,
      days: rule.days,
      keepLast: rule.keepLast,
      rosterChanged: rule.rosterFingerprint !== roster,
    }))
  return {
    executorAvailable: executorAvailable(),
    executorEnabled: executionEnabled(),
    restoreHold: restoreHeld(),
    lostCleanupHistory: externalMaintenanceFences().some(
      fence => fence.state === 'finalized',
    ),
    nextRunAt: maintenanceNextRunAt(),
    operations: maintenanceOperationList(),
    externalFences: externalFenceList(),
    defaultRule: maintenanceConfig(DEFAULT_RULE).rule,
    rules,
    rulesEnabled: rules.filter(rule => rule.enabled).length,
    groups: db
      .select({ id: maintenanceGroups.id })
      .from(maintenanceGroups)
      .all()
      .length,
    suppressions: db
      .select({
        titleId: maintenanceSuppressions.titleId,
        season: maintenanceSuppressions.season,
        episode: maintenanceSuppressions.episode,
        status: maintenanceSuppressions.status,
      })
      .from(maintenanceSuppressions)
      .all(),
  }
}

function ownershipForPreview() {
  const db = getDb()
  const cleaned = new Set(
    db
      .select({ groupId: maintenanceOperations.groupId })
      .from(maintenanceOperations)
      .where(eq(maintenanceOperations.state, 'cleaned'))
      .all()
      .map(row => row.groupId),
  )
  const owned = db
    .select()
    .from(maintenanceFiles)
    .all()
    .filter(file => !cleaned.has(file.groupId))
  const ownedEntries = new Map(
    owned.map(file => [file.id, new Set(maintenancePathKeys(file.path))]),
  )
  return { cleaned, owned, ownedEntries }
}

/** Предпросмотр читает только сохранённые факты и stat; сеть и записи запрещены. */
export async function previewMaintenance(
  titleId: string,
  rule: Rule,
  now = Date.now(),
  options: {
    ownership?: ReturnType<typeof ownershipForPreview>
    rosterChanged?: boolean
  } = {},
) {
  const db = getDb()
  const config = maintenanceConfig(titleId)
  // Исторический manifest остаётся в журнале, но больше не владеет новым
  // файлом, появившимся на прежнем пути после явного allow-redownload.
  const { cleaned, owned, ownedEntries }
    = options.ownership ?? ownershipForPreview()
  const rows = db
    .select()
    .from(maintenanceGroups)
    .where(eq(maintenanceGroups.titleId, titleId))
    .all()
  const media = db
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.titleId, titleId))
    .all()
  const folders = new Map(
    db
      .select()
      .from(libraryFolders)
      .all()
      .map(row => [row.id, row]),
  )
  const managed = new Set(
    db
      .select()
      .from(libraries)
      .where(eq(libraries.managed, true))
      .all()
      .map(row => row.id),
  )
  const liveRows = new Map(
    db
      .select()
      .from(torrents)
      .all()
      .map(row => [row.id, row]),
  )
  const sessions = playbackResources()
  const moving = !!db
    .select()
    .from(storageMoves)
    .where(eq(storageMoves.status, 'running'))
    .get()
  const refreshing
    = db
      .select()
      .from(trackedTopics)
      .where(
        and(
          eq(trackedTopics.titleId, titleId),
          isNotNull(trackedTopics.refresh),
        ),
      )
      .all()
      .length > 0
  const represented = new Set<string>()
  const groups: CandidateGroup[] = []
  for (const row of rows.filter(row => !cleaned.has(row.id))) {
    const files = owned.filter(file => file.groupId === row.id)
    const episodes = new Map(
      files.flatMap(file =>
        file.episodes.map(
          episode =>
            [`${episode.season}:${episode.episode}`, episode] as const,
        ),
      ),
    )
    const reasons: Reason[] = row.identityUncertain ? ['identity_changed'] : []
    if (
      !Number.isSafeInteger(row.pieceCount)
      || (row.pieceCount ?? 0) <= 0
      || !row.sourceRootDevice
      || !Number.isSafeInteger(row.sourceRootInode)
    ) {
      reasons.push('unknown_identity')
    }
    const torrent = row.torrentId ? liveRows.get(row.torrentId) : undefined
    if (
      moving
      || refreshing
      || torrent?.pauseReason
      || media.some(
        file =>
          files.some(owned => owned.mediaFileId === file.id)
          && (file.stale || file.replacementTorrentId),
      )
    ) {
      reasons.push('active_operation')
    }
    if (
      sessions.some(
        session =>
          (row.torrentId && session.torrentId === row.torrentId)
          || files.some(file => file.mediaFileId === session.mediaFileId),
      )
    ) {
      reasons.push('active_playback')
    }
    const selected = new Set(files.map(file => file.fileIndex))
    if (
      !files.some(file => file.kind === 'library')
      || row.selectedFiles.some(index => !selected.has(index))
      || row.torrentFiles.some(
        (file, index) =>
          !file.padding
          && (isVideoFile(file.path) || /\.vob$/i.test(file.path))
          && !selected.has(index),
      )
    ) {
      reasons.push('group_incomplete')
    }
    for (const file of files) {
      if (file.mediaFileId)
        represented.add(file.mediaFileId)
      const current = file.mediaFileId
        ? media.find(item => item.id === file.mediaFileId)
        : undefined
      if (file.kind !== 'source') {
        const folder = current ? folders.get(current.folderId) : undefined
        if (!folder || !managed.has(folder.libraryId))
          reasons.push('external_library')
        if (
          !current
          || current.state !== 'present'
          || folder?.status === 'offline'
          || folder?.status === 'denied'
        ) {
          reasons.push('file_unavailable')
        }
        if (
          current
          && (current.titleId !== row.titleId
            || current.matchSource === 'user'
            || (file.kind === 'library'
              && join(folder?.path ?? '', current.relPath) !== file.path))
        ) {
          reasons.push('identity_changed')
        }
      }
      const identity = await verifyOwnedFile(file)
      if (identity === 'identity_changed') {
        reasons.push('identity_changed')
      }
      else if (
        identity === 'root_unavailable'
        || (identity === 'missing'
          && (file.kind !== 'source' || !row.sourceEvictedAt))
      ) {
        reasons.push('file_unavailable')
      }
      if (
        owned.some(
          other =>
            other.groupId !== row.id
            && [...ownedEntries.get(file.id)!].some(key =>
              ownedEntries.get(other.id)!.has(key),
            ),
        )
      ) {
        reasons.push('group_incomplete')
      }
    }
    groups.push({
      id: row.id,
      revision: row.revision,
      titleId,
      protected: row.manualProtection,
      proven: row.origin === 'follow',
      episodes: [...episodes.values()],
      files: files
        .filter(file => file.kind !== 'source' || !row.sourceEvictedAt)
        .map(file => ({
          name: basename(file.path),
          kind: file.kind,
          size: file.size,
          volume: file.device,
          allocationKey: `${file.device}:${file.inode}`,
        })),
      reasons,
      seedRule:
        torrent?.retention === 'keep'
          ? (torrent.seedRule ?? getTorrentSettings().seedRule)
          : row.seedRule,
      completedAt: row.completedAt?.getTime() ?? null,
      uploaded: row.uploaded,
      denominator: row.denominator,
      lastActivityAt: row.lastActivityAt?.getTime() ?? null,
      eligibleSince: row.eligibleSince?.getTime() ?? null,
    })
  }
  for (const file of media.filter(file => !represented.has(file.id))) {
    const folder = folders.get(file.folderId)
    groups.push({
      id: `legacy:${file.id}`,
      revision: 0,
      titleId,
      protected: true,
      proven: false,
      episodes: episodesOf(file),
      files: [
        {
          name: basename(file.relPath),
          kind: 'library',
          size: file.size,
          volume:
            folder?.device === null || folder?.device === undefined
              ? null
              : String(folder.device),
        },
      ],
      reasons:
        folder && managed.has(folder.libraryId) ? [] : ['external_library'],
      seedRule: null,
      completedAt: null,
      uploaded: null,
      denominator: null,
      lastActivityAt: null,
      eligibleSince: null,
    })
  }
  return {
    ...evaluateMaintenance({
      now,
      rule,
      rosterChanged: options.rosterChanged ?? config.rule.rosterChanged,
      profiles: config.profiles.map(row => row.id),
      favorite: !!db
        .select()
        .from(profileTitles)
        .where(
          and(
            eq(profileTitles.titleId, titleId),
            isNotNull(profileTitles.favoriteAt),
          ),
        )
        .get(),
      followState:
        db.select().from(follows).where(eq(follows.titleId, titleId)).get()?.state ?? null,
      available: (
        await Promise.all(
          media.map(async (file) => {
            const folder = folders.get(file.folderId)
            if (
              !folder
              || !managed.has(folder.libraryId)
              || file.state !== 'present'
              || file.stale
              || ['offline', 'denied'].includes(folder.status)
            ) {
              return null
            }
            const identity = await ownedIdentity(
              folder.path,
              join(folder.path, file.relPath),
            )
            return identity
              && identity.size === file.size
              && identity.inode === file.inode
              && Math.trunc(identity.mtime) === file.mtime.getTime()
              && (folder.device === null
                || String(folder.device) === identity.device)
              ? { id: file.id, episodes: episodesOf(file) }
              : null
          }),
        )
      ).filter(
        (
          file,
        ): file is { id: string, episodes: ReturnType<typeof episodesOf> } =>
          file !== null,
      ),
      progress: db
        .select()
        .from(titleProgress)
        .where(eq(titleProgress.titleId, titleId))
        .all()
        .map(row => ({
          ...row,
          watchedAt: row.watchedAt?.getTime() ?? null,
          lastPlayedAt: row.lastPlayedAt?.getTime() ?? null,
        })),
      groups,
    }),
    executorAvailable: executorAvailable(),
  }
}

export async function previewDefaultMaintenance(rule: Rule) {
  const db = getDb()
  const overrides = db
    .select({ id: maintenanceRules.titleId })
    .from(maintenanceRules)
    .where(eq(maintenanceRules.inherits, false))
  const titles = db
    .select({ id: follows.titleId, kind: follows.kind })
    .from(follows)
    .where(notInArray(follows.titleId, overrides))
    .all()
  const withFiles = new Set(
    [
      ...db
        .selectDistinct({ id: maintenanceGroups.titleId })
        .from(maintenanceGroups)
        .all(),
      ...db.selectDistinct({ id: mediaFiles.titleId }).from(mediaFiles).all(),
    ].map(row => row.id),
  )
  const ownership = ownershipForPreview()
  const now = Date.now()
  const items = []
  for (const title of titles) {
    if (!withFiles.has(title.id))
      continue
    const effective
      = title.kind === 'movie' ? { ...rule, keepLast: null } : rule
    const preview = await previewMaintenance(title.id, effective, now, {
      ownership,
      rosterChanged: false,
    })
    if (preview.groups.length)
      items.push({ titleId: title.id, preview })
  }
  return { titleCount: titles.length, items }
}
