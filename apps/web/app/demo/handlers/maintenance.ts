import type {
  MaintenanceConfig,
  MaintenanceDefaultPreview,
  MaintenanceExecutionInput,
  MaintenanceGroup,
  MaintenancePreview,
  MaintenanceProtectionInput,
  MaintenanceRuleOptionsInput,
  MaintenanceSaveInput,
  MaintenanceStatus,
  MaintenanceUnsuppressInput,
  MessageResponse,
} from '@torsher/api-client'
import { MaintenanceReason } from '@torsher/api-client'
import { DemoError, get, patch, post } from '@torsher/demo/router'
import { isFresh } from '@torsher/demo/state'
import { findTitle } from '@torsher/demo/titles'
import { demoFollowTitleIds } from './follow'
import { listProfiles } from './people'

const configs = new Map<string, MaintenanceConfig>()
const groups = new Map<string, MaintenanceGroup>()
let execution = false
function config(titleId: string): MaintenanceConfig {
  const profiles = listProfiles().map(({ id, name }) => ({ id, name }))
  const local = configs.get(titleId)
  const inherited = titleId !== 'default' && (!local || local.inherited)
  const base = inherited ? configs.get('default') : local
  return {
    profiles,
    inherited,
    executorAvailable: true,
    rule: {
      titleId,
      revision: local?.rule.revision ?? 0,
      rosterChanged: false,
      enabled: base?.rule.enabled ?? false,
      days: base?.rule.days ?? 30,
      keepLast: titleId.startsWith('tmdb:movie:')
        ? null
        : (base?.rule.keepLast ?? null),
      profileIds: base?.rule.profileIds ?? profiles.map(p => p.id),
    },
  }
}
function save(id: string, body: MaintenanceSaveInput) {
  const current = config(id)
  if (current.rule.revision !== body.expectedRevision)
    throw new DemoError(409)
  const { expectedRevision, ...options } = body
  current.rule = {
    ...current.rule,
    ...options,
    revision: expectedRevision + 1,
  }
  current.inherited = false
  configs.set(id, current)
  return current
}
function status(): MaintenanceStatus {
  return {
    executorAvailable: true,
    executorEnabled: execution,
    restoreHold: false,
    lostCleanupHistory: false,
    nextRunAt: execution ? new Date(Date.now() + 86400000).toISOString() : null,
    operations: [],
    externalFences: [],
    defaultRule: config('default').rule,
    rules: [...configs.values()]
      .filter(c => c.rule.titleId !== 'default' && !c.inherited)
      .map(c => c.rule),
    rulesEnabled: [...configs.values()].filter(
      c => !c.inherited && c.rule.titleId !== 'default' && c.rule.enabled,
    ).length,
    groups: groups.size,
    suppressions: [],
  }
}
get<MaintenanceStatus>('/api/library-maintenance/status', status)
get<MaintenanceConfig>(
  '/api/library-maintenance/titles/:titleId',
  ({ params }) => config(params.titleId!),
)
patch<MaintenanceConfig, MaintenanceSaveInput>(
  '/api/library-maintenance/titles/:titleId',
  ({ params, body }) => save(params.titleId!, body),
)
get<MaintenanceConfig>('/api/library-maintenance/default', () =>
  config('default'))
patch<MaintenanceConfig, MaintenanceSaveInput>(
  '/api/library-maintenance/default',
  ({ body }) => save('default', body),
)
post<MaintenanceConfig, { expectedRevision: number, defaultRevision: number }>(
  '/api/library-maintenance/titles/:titleId/inherit',
  ({ params, body }) => {
    const current = config(params.titleId!)
    if (
      current.inherited
      || current.rule.revision !== body.expectedRevision
      || config('default').rule.revision !== body.defaultRevision
    ) {
      throw new DemoError(409)
    }
    current.inherited = true
    current.rule.revision++
    configs.set(params.titleId!, current)
    return config(params.titleId!)
  },
)
post<MaintenancePreview>(
  '/api/library-maintenance/titles/:titleId/inherit/preview',
  ({ params }) => preview(params.titleId!, config('default').rule),
)
post<MaintenanceDefaultPreview, MaintenanceRuleOptionsInput>(
  '/api/library-maintenance/default/preview',
  ({ body }) => {
    const ids = demoFollowTitleIds().filter(id => config(id).inherited)
    return {
      titleCount: ids.length,
      items: ids.map(titleId => ({
        titleId,
        preview: preview(titleId, body),
      })),
    }
  },
)
post<MaintenancePreview, MaintenanceRuleOptionsInput>(
  '/api/library-maintenance/titles/:titleId/preview',
  ({ params, body }) => preview(params.titleId!, body),
)
function preview(
  titleId: string,
  body: MaintenanceRuleOptionsInput,
): MaintenancePreview {
  const title = findTitle(titleId)
  if (isFresh || !title) {
    return {
      evaluatedAt: new Date().toISOString(),
      executorAvailable: true,
      estimate: true,
      groups: [],
      volumes: [],
    }
  }
  if (!groups.has(titleId)) {
    groups.set(titleId, {
      id: titleId,
      revision: 0,
      titleId,
      protected: false,
      candidate: false,
      reasons: [],
      eligibleAt: null,
      eligibleSince: null,
      episodes:
        title.kind === 'series'
          ? [
              { season: 1, episode: 1 },
              { season: 1, episode: 2 },
            ]
          : [],
      files: [
        {
          name: `${title.title}.DEMO.mkv`,
          kind: 'library',
          size: 536870912,
          volume: '/library',
        },
      ],
      logicalBytes: 536870912,
    })
  }
  const group = groups.get(titleId)!
  group.reasons = !body.enabled
    ? [MaintenanceReason.Disabled]
    : group.protected
      ? [MaintenanceReason.ManualProtection]
      : [MaintenanceReason.GracePeriod]
  group.candidate = body.enabled && !group.protected
  return {
    evaluatedAt: new Date().toISOString(),
    executorAvailable: true,
    estimate: true,
    groups: [group],
    volumes: [{ volume: '/library', logicalBytes: group.logicalBytes }],
  }
}
patch<{ id: string, revision: number }, MaintenanceProtectionInput>(
  '/api/library-maintenance/groups/:id/protection',
  ({ params, body }) => {
    const group = groups.get(params.id!)
    if (!group || group.revision !== body.expectedRevision)
      throw new DemoError(409)
    group.protected = body.protected
    group.revision++
    return { id: group.id, revision: group.revision }
  },
)
post<MessageResponse, MaintenanceUnsuppressInput>(
  '/api/library-maintenance/titles/:titleId/unsuppress',
  () => ({ message: 'OK' }),
)
patch<MaintenanceStatus, MaintenanceExecutionInput>(
  '/api/library-maintenance/execution',
  ({ body }) => {
    execution = body.enabled
    return status()
  },
)
post<MaintenanceStatus>('/api/library-maintenance/restore/acknowledge', () => {
  execution = false
  return status()
})
post<MaintenanceStatus>(
  '/api/library-maintenance/operations/:id/retry',
  status,
)
post<MaintenanceStatus>(
  '/api/library-maintenance/external-fences/:id/cancel',
  status,
)
