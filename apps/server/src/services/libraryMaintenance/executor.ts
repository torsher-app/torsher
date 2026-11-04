import { notify } from '../notifications/index.ts'
import process from 'node:process'
import { statfs } from 'node:fs/promises'
import { rootIdentity } from './identity.ts'
import { durableMaintenance } from './durable.ts'
import { getTorrentSettings } from '../torrents/settings.ts'
import type {
  MaintenanceManifest,
  MaintenanceVolumeObservation,
} from '../../db/schema.ts'
import { createHash, randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  follows,
  maintenanceFiles,
  maintenanceGroups,
  maintenanceOperations,
  maintenanceSuppressions,
  mediaFiles,
  profiles,
  profileTitles,
  titleProgress,
  torrents,
} from '../../db/schema.ts'
import * as engine from '../engine/client.ts'
import { removeThumbs } from '../library/thumbs.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import {
  acquireMaintenanceExclusive,
  assertMaintenancePolicyChange,
  externalMaintenanceFences,
  MaintenanceBusyError,
  unresolvedOperations,
} from './admission.ts'
import { logFor } from '../logs/index.ts'
import { DAY } from './evaluate.ts'
import { maintenanceConfig, policyFacts, previewMaintenance } from './index.ts'
import { clearMaintenanceRestoreHold, restoreHeld } from './restore.ts'

/** Подмена только в синтетических тестах; production всегда использует Go fence. */
export const maintenanceEngine = {
  prepare: engine.prepareMaintenanceDetach,
  status: engine.getMaintenanceOperation,
  unlink: engine.unlinkMaintenanceFile,
  finalize: engine.finalizeMaintenanceDetach,
  cancel: engine.cancelMaintenanceDetach,
  list: engine.listMaintenanceOperations,
}
type Operation = typeof maintenanceOperations.$inferSelect
export function executionEnabled() {
  return getSetting<boolean>('maintenanceExecutionEnabled') === true
}
let maintenanceReady = false
export function executorAvailable() {
  return (
    maintenanceReady
    && ['darwin', 'linux'].includes(process.platform)
    && engine.isEngineReady()
  )
}
let running = false
let timer: ReturnType<typeof setInterval> | undefined
const cancellationPolls = new Map<string, ReturnType<typeof setTimeout>>()
let nextRunAt: Date | null = null
export function maintenanceNextRunAt() {
  return nextRunAt?.toISOString() ?? null
}

/** Состояние grace/results не входит: сравниваются исходные факты политики. */
export function eligibilityFingerprint(groupId: string) {
  const db = getDb()
  const group = db
    .select()
    .from(maintenanceGroups)
    .where(eq(maintenanceGroups.id, groupId))
    .get()
  if (!group)
    return ''
  const {
    eligibleSince: _since,
    eligibilityFingerprint: _fingerprint,
    uploaded: _uploaded,
    ...facts
  } = group
  const value = {
    group: facts,
    seedDefault: getTorrentSettings().seedRule,
    live: group.torrentId
      ? db
          .select({
            titleId: torrents.titleId,
            retention: torrents.retention,
            selectedFiles: torrents.selectedFiles,
            downloadDir: torrents.downloadDir,
            seedRule: torrents.seedRule,
          })
          .from(torrents)
          .where(eq(torrents.id, group.torrentId))
          .get()
      : null,
    files: db
      .select()
      .from(maintenanceFiles)
      .where(eq(maintenanceFiles.groupId, groupId))
      .all()
      .sort((a, b) => a.id.localeCompare(b.id)),
    rule: policyFacts(group.titleId),
    profiles: db
      .select({ id: profiles.id })
      .from(profiles)
      .all()
      .sort((a, b) => a.id.localeCompare(b.id)),
    favorites: db
      .select({
        profileId: profileTitles.profileId,
        favoriteAt: profileTitles.favoriteAt,
      })
      .from(profileTitles)
      .where(eq(profileTitles.titleId, group.titleId))
      .all()
      .sort((a, b) => a.profileId.localeCompare(b.profileId)),
    follow: db
      .select({ id: follows.id, state: follows.state })
      .from(follows)
      .where(eq(follows.titleId, group.titleId))
      .all(),
    progress: db
      .select()
      .from(titleProgress)
      .where(eq(titleProgress.titleId, group.titleId))
      .all()
      .sort((a, b) =>
        `${a.profileId}:${a.season}:${a.episode}`.localeCompare(
          `${b.profileId}:${b.season}:${b.episode}`,
        ),
      ),
  }
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function patch(
  id: string,
  values: Partial<typeof maintenanceOperations.$inferInsert>,
) {
  durableMaintenance(() =>
    getDb()
      .update(maintenanceOperations)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(maintenanceOperations.id, id))
      .run(),
  )
}
function operation(id: string) {
  return getDb()
    .select()
    .from(maintenanceOperations)
    .where(eq(maintenanceOperations.id, id))
    .get()
}
function wireManifest(manifest: MaintenanceManifest) {
  return engine.engineDetachManifest.parse(manifest)
}
function assertManifest(
  op: Operation,
  reply: engine.EngineMaintenanceOperation,
) {
  if (
    reply.id !== op.id
    || JSON.stringify(wireManifest(reply.manifest as MaintenanceManifest))
    !== JSON.stringify(wireManifest(op.manifest))
  ) {
    throw new Error('engine_manifest_mismatch')
  }
}
function errorCode(error: unknown) {
  return error instanceof engine.EngineError
    ? (error.engineCode ?? error.kind)
    : error instanceof Error && /^[a-z_]+$/.test(error.message)
      ? error.message
      : 'maintenance_failed'
}
async function cancelUnchanged(
  op: Operation,
  confirmation?: engine.EngineMaintenanceOperation,
) {
  const reply = confirmation ?? (await maintenanceEngine.cancel(op.id))
  assertManifest(op, reply)
  if (reply.state === 'reattaching' && !Object.keys(reply.results).length) {
    patch(op.id, {
      state: reply.error ? 'blocked' : 'pending',
      engineStage: 'reattaching',
      error: reply.error ?? null,
    })
    if (!reply.error)
      pollCancellation(op.id)
    return
  }
  if (reply.state !== 'cancelled' || Object.keys(reply.results).length)
    throw new Error('cancel_not_confirmed')
  durableMaintenance(() => {
    patch(op.id, {
      state: 'cancelled',
      engineStage: 'cancelled',
      error: 'policy_changed',
    })
    getDb()
      .delete(maintenanceSuppressions)
      .where(eq(maintenanceSuppressions.operationId, op.id))
      .run()
    getDb()
      .update(maintenanceGroups)
      .set({ eligibleSince: null, eligibilityFingerprint: null })
      .where(eq(maintenanceGroups.id, op.groupId))
      .run()
  })
}
/** Опрос только отмены: он никогда не продолжает удаление или повторный reattach после ошибки. */
function pollCancellation(id: string) {
  if (cancellationPolls.has(id))
    return
  const timer = setTimeout(async () => {
    cancellationPolls.delete(id)
    const op = operation(id)
    if (!op || op.engineStage !== 'reattaching')
      return
    try {
      const reply = await maintenanceEngine.status(id)
      await cancelUnchanged(op, reply)
    }
    catch (error) {
      patch(id, { error: errorCode(error) })
    }
  }, 1000)
  timer.unref()
  cancellationPolls.set(id, timer)
}
async function observedFree(root: string, device: string, inode: number) {
  const identity = await rootIdentity(root)
  if (
    !identity
    || identity.rootDevice !== device
    || identity.rootInode !== inode
  ) {
    return null
  }
  try {
    const stat = await statfs(root)
    const bytes = stat.bavail * stat.bsize
    return Number.isSafeInteger(bytes) ? bytes : null
  }
  catch {
    return null
  }
}
async function observeVolumes(
  manifest: MaintenanceManifest,
): Promise<MaintenanceVolumeObservation[]> {
  const roots = new Map(manifest.paths.map(file => [file.rootDevice, file]))
  return Promise.all(
    [...roots.values()].map(async file => ({
      volume: file.rootDevice,
      root: file.root,
      rootInode: file.rootInode,
      beforeFree: await observedFree(
        file.root,
        file.rootDevice,
        file.rootInode,
      ),
      afterFree: null,
    })),
  )
}
async function commitCleaned(op: Operation) {
  const db = getDb()
  const ids = [
    ...new Set(
      op.manifest.paths.flatMap(file =>
        file.mediaFileId ? [file.mediaFileId] : [],
      ),
    ),
  ]
  const thumbs = ids.length
    ? db
        .select()
        .from(mediaFiles)
        .where(inArray(mediaFiles.id, ids))
        .all()
        .map(file => file.thumb)
    : []
  durableMaintenance(() => {
    if (ids.length) {
      db.update(titleProgress)
        .set({ mediaFileId: null })
        .where(inArray(titleProgress.mediaFileId, ids))
        .run()
      db.delete(mediaFiles).where(inArray(mediaFiles.id, ids)).run()
    }
    const group = db
      .select()
      .from(maintenanceGroups)
      .where(eq(maintenanceGroups.id, op.groupId))
      .get()
    if (group?.torrentId) {
      db.update(titleProgress)
        .set({ torrentId: null, fileIndex: null })
        .where(eq(titleProgress.torrentId, group.torrentId))
        .run()
      db.delete(torrents).where(eq(torrents.id, group.torrentId)).run()
    }
    db.update(maintenanceSuppressions)
      .set({ status: 'cleaned' })
      .where(eq(maintenanceSuppressions.operationId, op.id))
      .run()
    patch(op.id, { state: 'cleaned', error: null })
  })
  await removeThumbs(thumbs)
  const volumes = await Promise.all(
    op.volumes.map(async volume => ({
      ...volume,
      afterFree: await observedFree(
        volume.root,
        volume.volume,
        volume.rootInode,
      ),
    })),
  )
  patch(op.id, { volumes })
}
/** Возобновление не обходит политику. После partial fence остаётся до решения владельца. */
export async function retryMaintenanceOperation(id: string) {
  let op = operation(id)
  if (!op || op.state === 'cancelled')
    return false
  const release = acquireMaintenanceExclusive(op.groupId)
  try {
    if (op.state === 'cleaned') {
      const reply = await maintenanceEngine.finalize(op.id)
      assertManifest(op, reply)
      if (reply.state !== 'finalized')
        throw new Error('finalize_not_confirmed')
      patch(id, { engineStage: 'finalized', error: null })
      return true
    }
    // prepare идемпотентен и при потерянном HTTP-ответе; отсутствие не считается ack.
    const detached = await maintenanceEngine.prepare(
      op.id,
      wireManifest(op.manifest),
    )
    assertManifest(op, detached)
    if (
      detached.state === 'cancelled'
      && !Object.keys(detached.results).length
    ) {
      await cancelUnchanged(op, detached)
      return false
    }
    if (detached.state === 'reattaching') {
      await cancelUnchanged(op)
      return false
    }
    if (detached.state === 'finalized')
      throw new Error('restored_operation_already_finalized')
    if (!['detached', 'deleting'].includes(detached.state))
      throw new Error('detach_not_confirmed')
    patch(id, {
      state: Object.keys(detached.results).length ? 'deleting' : 'detached',
      engineStage: detached.state,
      results: detached.results,
    })
    op = operation(id)!
    const changed = eligibilityFingerprint(op.groupId) !== op.fingerprint
    if (changed || restoreHeld() || !executionEnabled()) {
      if (!Object.keys(op.results).length) {
        await cancelUnchanged(op)
      }
      else {
        patch(id, {
          state: 'partial',
          error: changed ? 'policy_changed' : 'execution_held',
        })
      }
      return false
    }
    if (!Object.keys(op.results).length) {
      const config = maintenanceConfig(op.titleId)
      const preview = await previewMaintenance(op.titleId, config.rule)
      if (
        !preview.groups.find(group => group.id === op!.groupId)?.candidate
      ) {
        await cancelUnchanged(op)
        return false
      }
    }
    for (let index = 0; index < op.manifest.paths.length; index++) {
      if (op.results[String(index)] === 'removed')
        continue
      if (
        eligibilityFingerprint(op.groupId) !== op.fingerprint
        || restoreHeld()
        || !executionEnabled()
      ) {
        throw new Error('policy_changed')
      }
      patch(id, { state: 'deleting' })
      const reply = await maintenanceEngine.unlink(id, index)
      assertManifest(op, reply)
      if (reply.results[String(index)] !== 'removed')
        throw new Error('unlink_not_confirmed')
      patch(id, { results: reply.results, engineStage: reply.state })
      op = operation(id)!
    }
    await commitCleaned(op)
    const reply = await maintenanceEngine.finalize(id)
    assertManifest(op, reply)
    if (reply.state !== 'finalized')
      throw new Error('finalize_not_confirmed')
    patch(id, { engineStage: 'finalized', error: null })
    return true
  }
  catch (error) {
    // Ответ unlink мог потеряться. Не снимаем hold даже если локально ещё нет results.
    const current = operation(id)!
    logFor('storage').warn(
      { operationId: id, reason: errorCode(error) },
      'Library maintenance needs attention',
    )
    patch(id, {
      state:
        current.state === 'cleaned'
          ? 'cleaned'
          : current.state === 'deleting' || Object.keys(current.results).length
            ? 'partial'
            : 'blocked',
      error: errorCode(error),
    })
    return false
  }
  finally {
    release()
  }
}
export async function runMaintenance(now = Date.now()) {
  if (running || !executionEnabled() || restoreHeld() || !executorAvailable())
    return
  running = true
  let cleaned = 0
  try {
    const titles = getDb()
      .selectDistinct({ titleId: maintenanceGroups.titleId })
      .from(maintenanceGroups)
      .all()
    for (const { titleId } of titles) {
      const { rule } = maintenanceConfig(titleId)
      if (!rule.enabled)
        continue
      const preview = await previewMaintenance(rule.titleId, rule, now)
      for (const group of preview.groups) {
        if (!executionEnabled() || restoreHeld() || !executorAvailable())
          break
        if (
          group.id.startsWith('legacy:')
          || unresolvedOperations().some(op => op.groupId === group.id)
        ) {
          continue
        }
        let release: (() => void) | undefined
        try {
          release = acquireMaintenanceExclusive(group.id)
          const row = getDb()
            .select()
            .from(maintenanceGroups)
            .where(eq(maintenanceGroups.id, group.id))
            .get()!
          const fingerprint = eligibilityFingerprint(group.id)
          const fresh = (
            await previewMaintenance(
              rule.titleId,
              maintenanceConfig(rule.titleId).rule,
              now,
            )
          ).groups.find(item => item.id === group.id)
          if (
            !fresh?.candidate
            || fingerprint !== eligibilityFingerprint(group.id)
          ) {
            getDb()
              .update(maintenanceGroups)
              .set({ eligibleSince: null, eligibilityFingerprint: null })
              .where(eq(maintenanceGroups.id, group.id))
              .run()
            continue
          }
          if (
            !row.eligibleSince
            || row.eligibilityFingerprint !== fingerprint
          ) {
            getDb()
              .update(maintenanceGroups)
              .set({
                eligibleSince: new Date(now),
                eligibilityFingerprint: fingerprint,
              })
              .where(eq(maintenanceGroups.id, group.id))
              .run()
            continue
          }
          if (now - row.eligibleSince.getTime() < DAY)
            continue
          const files = getDb()
            .select()
            .from(maintenanceFiles)
            .where(eq(maintenanceFiles.groupId, group.id))
            .all()
          if (
            !row.pieceCount
            || files.some(
              file =>
                !file.rootDevice
                || !Number.isSafeInteger(file.rootInode)
                || !Number.isSafeInteger(file.inode)
                || !Number.isSafeInteger(file.size),
            )
          ) {
            continue
          }
          const manifest: MaintenanceManifest = {
            infoHash: row.initialInfoHash,
            pieceCount: row.pieceCount,
            paths: files.map(file => ({
              root: file.root,
              path: file.path,
              rootDevice: file.rootDevice!,
              rootInode: file.rootInode!,
              device: file.device,
              inode: file.inode,
              size: file.size,
              mtime: file.mtime,
              fileId: file.id,
              mediaFileId: file.mediaFileId,
              kind: file.kind,
            })),
          }
          const volumes = await observeVolumes(manifest)
          const id = randomUUID()
          durableMaintenance(() => {
            getDb()
              .insert(maintenanceOperations)
              .values({
                id,
                groupId: group.id,
                titleId: rule.titleId,
                groupRevision: row.revision,
                ruleRevision: rule.revision,
                fingerprint,
                manifest,
                volumes,
                episodes: group.episodes,
                state: 'pending',
              })
              .run()
            for (const episode of group.episodes) {
              getDb()
                .insert(maintenanceSuppressions)
                .values({
                  titleId: rule.titleId,
                  ...episode,
                  status: 'pending',
                  operationId: id,
                })
                .onConflictDoUpdate({
                  target: [
                    maintenanceSuppressions.titleId,
                    maintenanceSuppressions.season,
                    maintenanceSuppressions.episode,
                  ],
                  set: { status: 'pending', operationId: id },
                })
                .run()
            }
          })
          release()
          release = undefined
          if (await retryMaintenanceOperation(id))
            cleaned++
        }
        catch (error) {
          // Занятая группа ждёт; ошибки хранения не скрываются.
          if (!(error instanceof MaintenanceBusyError)) {
            logFor('storage').error(
              { groupId: group.id, reason: errorCode(error) },
              'Library maintenance evaluation failed',
            )
          }
        }
        finally {
          release?.()
        }
      }
    }
  }
  finally {
    if (cleaned) {
      notify(
        {
          kind: 'maintenance_completed',
          severity: 'info',
          section: 'storage',
          params: { count: cleaned },
        },
        { external: false },
      )
      logFor('storage').info(
        { groups: cleaned },
        'Library maintenance completed',
      )
    }
    running = false
    nextRunAt = new Date(now + DAY)
  }
}
export async function recoverMaintenance() {
  maintenanceReady = false
  const fences = await maintenanceEngine.list()
  maintenanceReady = true
  const known = new Set(
    getDb()
      .select()
      .from(maintenanceOperations)
      .all()
      .map(op => op.id),
  )
  for (const fence of fences) {
    if (known.has(fence.id) && fence.state === 'cancelled') {
      const op = operation(fence.id)
      if (op?.engineStage === 'reattaching')
        await cancelUnchanged(op, fence)
    }
    if (known.has(fence.id) && fence.state === 'reattaching') {
      patch(fence.id, {
        state: fence.error ? 'blocked' : 'pending',
        engineStage: 'reattaching',
        error: fence.error ?? null,
      })
      if (!fence.error)
        pollCancellation(fence.id)
    }
  }
  const unknown = fences.filter(
    fence => !known.has(fence.id) && fence.state !== 'cancelled',
  )
  const previous = new Set(
    externalMaintenanceFences().map(fence => fence.id),
  )
  setSetting('maintenanceExternalFences', unknown)
  for (const fence of unknown) {
    if (fence.state === 'reattaching' && !fence.error)
      pollExternalCancellation(fence.id)
  }
  if (unknown.some(fence => !previous.has(fence.id))) {
    setSetting('maintenanceRestoreHold', true)
    setSetting('maintenanceExecutionEnabled', false)
  }
  for (const op of unresolvedOperations()) {
    if (op.engineStage !== 'reattaching')
      await retryMaintenanceOperation(op.id)
  }
}
export async function acknowledgeMaintenanceRestore() {
  await recoverMaintenance()
  // Каждый незавершённый файл остаётся точечно закрыт durable fence/admission.
  // Подтверждение не означает разрешения продолжать удаление.
  const fences = await maintenanceEngine.list()
  if (
    unresolvedOperations().some(
      op => !fences.some(fence => fence.id === op.id),
    )
  ) {
    return false
  }
  clearMaintenanceRestoreHold()
  return true
}
export function setMaintenanceExecution(enabled: boolean) {
  if (enabled)
    assertMaintenancePolicyChange({ global: true })
  if (enabled && (restoreHeld() || !executorAvailable()))
    return false
  durableMaintenance(() => setSetting('maintenanceExecutionEnabled', enabled))
  // Повторное включение начинается с новой grace, даже если раньше задача успела созреть.
  getDb()
    .update(maintenanceGroups)
    .set({ eligibleSince: null, eligibilityFingerprint: null })
    .run()
  return true
}
export function startMaintenanceScheduler() {
  if (timer)
    return
  nextRunAt = new Date(Date.now() + DAY)
  timer = setInterval(() => {
    void runMaintenance().catch(() =>
      logFor('storage').error('Library maintenance scheduler failed'),
    )
  }, DAY)
  timer.unref()
  void runMaintenance().catch(() =>
    logFor('storage').error('Library maintenance scheduler failed'),
  )
}
export function stopMaintenanceScheduler() {
  for (const timer of cancellationPolls.values()) clearTimeout(timer)
  cancellationPolls.clear()
  if (timer)
    clearInterval(timer)
  timer = undefined
  nextRunAt = null
}

export async function cancelExternalMaintenanceFence(id: string) {
  const fence = externalMaintenanceFences().find(item => item.id === id)
  if (!fence || Object.keys(fence.results).length)
    return false
  const reply = await maintenanceEngine.cancel(id)
  if (reply.state === 'reattaching' && !Object.keys(reply.results).length) {
    setSetting(
      'maintenanceExternalFences',
      externalMaintenanceFences().map(item =>
        item.id === id ? reply : item,
      ),
    )
    if (!reply.error)
      pollExternalCancellation(id)
    return true
  }
  if (reply.state !== 'cancelled' || Object.keys(reply.results).length)
    return false
  setSetting(
    'maintenanceExternalFences',
    externalMaintenanceFences().filter(item => item.id !== id),
  )
  return true
}

function pollExternalCancellation(id: string) {
  const key = `external:${id}`
  if (cancellationPolls.has(key))
    return
  const timer = setTimeout(async () => {
    cancellationPolls.delete(key)
    try {
      const reply = await maintenanceEngine.status(id)
      if (Object.keys(reply.results).length)
        return
      setSetting(
        'maintenanceExternalFences',
        externalMaintenanceFences().flatMap(item =>
          item.id !== id ? [item] : reply.state === 'cancelled' ? [] : [reply],
        ),
      )
      if (reply.state === 'reattaching' && !reply.error)
        pollExternalCancellation(id)
    }
    catch {
      // Durable fence остаётся в списке; owner retry/recovery повторит сверку.
    }
  }, 1000)
  timer.unref()
  cancellationPolls.set(key, timer)
}
