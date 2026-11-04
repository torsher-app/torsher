import type { AttentionItem } from '../../dto/overview.ts'
import { basename } from 'node:path'
import { desc } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { maintenanceOperations } from '../../db/schema.ts'
import { metaCacheKeys, readMetaCache } from '../tmdb/cache.ts'
import {
  externalMaintenanceFences,
  unresolvedOperations,
} from './admission.ts'
import { restoreHeld } from './restore.ts'

function titleName(titleId: string) {
  for (const key of metaCacheKeys(`${titleId}:%`)) {
    const cached = readMetaCache<{ title?: string, name?: string }>(key)
    if (cached?.title || cached?.name)
      return cached.title ?? cached.name ?? null
  }
  return null
}
export function maintenanceOperationList() {
  const recent = getDb()
    .select()
    .from(maintenanceOperations)
    .orderBy(desc(maintenanceOperations.createdAt))
    .limit(100)
    .all()
  const rows = new Map(
    [...unresolvedOperations(), ...recent].map(op => [op.id, op]),
  )
  return [...rows.values()].map(op => ({
    id: op.id,
    groupId: op.groupId,
    titleId: op.titleId,
    titleName: titleName(op.titleId),
    episodes: op.episodes,
    state: op.state,
    engineStage: op.engineStage,
    error: op.error,
    action:
      (op.state === 'cleaned' && op.engineStage === 'finalized')
      || op.state === 'cancelled'
        ? ('none' as const)
        : ('retry' as const),
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
    volumes: op.volumes.map(({ volume, beforeFree, afterFree }) => ({
      volume,
      beforeFree,
      afterFree,
      observedFreeChange:
        beforeFree !== null && afterFree !== null
          ? afterFree - beforeFree
          : null,
    })),
    files: op.manifest.paths.map((file, index) => ({
      name: basename(file.path),
      path: file.path,
      kind: file.kind,
      result: op.results[String(index)] ?? ('pending' as const),
    })),
  }))
}
export function externalFenceList() {
  return externalMaintenanceFences().map(op => ({
    id: op.id,
    state: op.state,
    action:
      op.state === 'finalized'
        ? ('review_history' as const)
        : Object.keys(op.results).length
          ? ('inspect_files' as const)
          : ('cancel_preserve_files' as const),
    files: op.manifest.paths.map((file, index) => ({
      name: basename(file.path),
      path: file.path,
      result: op.results[String(index)] ?? ('pending' as const),
    })),
  }))
}
export function maintenanceAttention(): AttentionItem[] {
  const failed
    = unresolvedOperations().filter(
      op => op.error || ['partial', 'blocked'].includes(op.state),
    ).length
    + externalMaintenanceFences().filter(fence => fence.state !== 'finalized').length
  return [
    ...(failed
      ? [
          {
            kind: 'maintenance_failed' as const,
            severity: 'error' as const,
            section: 'storage' as const,
            params: { count: failed },
          },
        ]
      : []),
    ...(restoreHeld()
      ? [
          {
            kind: 'maintenance_restore_hold' as const,
            severity: 'warning' as const,
            section: 'storage' as const,
            params: {},
          },
        ]
      : []),
  ]
}
