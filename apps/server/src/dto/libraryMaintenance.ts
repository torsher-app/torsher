import { z } from 'zod'

export const maintenanceRuleInput = z
  .object({
    enabled: z.boolean(),
    days: z.number().int().min(1).max(36500),
    keepLast: z.number().int().min(1).max(10000).nullable(),
    profileIds: z.array(z.string().min(1)).min(1).max(1000),
  })
  .meta({ id: 'MaintenanceRuleOptions' })

export const maintenanceRule = maintenanceRuleInput
  .extend({
    titleId: z.string(),
    revision: z.number().int(),
    rosterChanged: z.boolean(),
  })
  .meta({ id: 'MaintenanceRule' })

export const maintenanceConfig = z
  .object({
    rule: maintenanceRule,
    inherited: z.boolean(),
    profiles: z.array(z.object({ id: z.string(), name: z.string() })),
    executorAvailable: z.boolean(),
  })
  .meta({ id: 'MaintenanceConfig' })

export const maintenanceSave = maintenanceRuleInput
  .extend({
    expectedRevision: z.number().int().min(0),
  })
  .meta({ id: 'MaintenanceSave' })

export const maintenanceReasons = z
  .enum([
    'disabled',
    'legacy',
    'manual_protection',
    'favorite',
    'follow_inactive',
    'profiles_changed',
    'profile_missing',
    'not_watched',
    'retention_period',
    'latest_episodes',
    'unknown_identity',
    'ambiguous_versions',
    'external_library',
    'file_unavailable',
    'identity_changed',
    'seeding_unknown',
    'seeding_always',
    'seeding_incomplete',
    'group_incomplete',
    'active_operation',
    'clock_invalid',
    'grace_period',
    'active_playback',
  ])
  .meta({ id: 'MaintenanceReason' })

export const maintenanceEpisode = z.object({
  season: z.number().int().min(0),
  episode: z.number().int().min(0),
})
export const maintenanceGroup = z
  .object({
    id: z.string(),
    revision: z.number().int(),
    titleId: z.string(),
    protected: z.boolean(),
    candidate: z.boolean(),
    reasons: z.array(maintenanceReasons),
    eligibleAt: z.string().nullable(),
    eligibleSince: z.string().nullable(),
    episodes: z.array(maintenanceEpisode),
    files: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(['source', 'library', 'sidecar']),
        size: z.number(),
        volume: z.string().nullable(),
      }),
    ),
    logicalBytes: z.number(),
  })
  .meta({ id: 'MaintenanceGroup' })

export const maintenancePreview = z
  .object({
    evaluatedAt: z.string(),
    executorAvailable: z.boolean(),
    estimate: z.literal(true),
    groups: z.array(maintenanceGroup),
    volumes: z.array(
      z.object({ volume: z.string().nullable(), logicalBytes: z.number() }),
    ),
  })
  .meta({ id: 'MaintenancePreview' })

export const maintenanceDefaultPreview = z
  .object({
    titleCount: z.number().int(),
    items: z.array(
      z.object({ titleId: z.string(), preview: maintenancePreview }),
    ),
  })
  .meta({ id: 'MaintenanceDefaultPreview' })

export const maintenanceProtection = z
  .object({
    protected: z.boolean(),
    expectedRevision: z.number().int().min(0),
  })
  .meta({ id: 'MaintenanceProtection' })

export const maintenanceUnsuppress = z
  .object({ episodes: z.array(maintenanceEpisode).min(1).max(1000) })
  .meta({ id: 'MaintenanceUnsuppress' })
export const maintenanceOperation = z
  .object({
    id: z.string(),
    groupId: z.string(),
    titleId: z.string(),
    titleName: z.string().nullable(),
    episodes: z.array(maintenanceEpisode),
    state: z.enum([
      'pending',
      'detached',
      'deleting',
      'partial',
      'cleaned',
      'blocked',
      'cancelled',
    ]),
    engineStage: z.string(),
    error: z.string().nullable(),
    action: z.enum(['none', 'retry', 'inspect_files']),
    createdAt: z.string(),
    updatedAt: z.string(),
    volumes: z.array(
      z.object({
        volume: z.string(),
        beforeFree: z.number().nullable(),
        afterFree: z.number().nullable(),
        observedFreeChange: z.number().nullable(),
      }),
    ),
    files: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        kind: z.enum(['source', 'library', 'sidecar']),
        result: z.enum(['pending', 'staged', 'removed']),
      }),
    ),
  })
  .meta({ id: 'MaintenanceOperation' })
export const maintenanceExternalFence = z
  .object({
    id: z.string(),
    state: z.string(),
    action: z.enum([
      'inspect_files',
      'cancel_preserve_files',
      'review_history',
    ]),
    files: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        result: z.enum(['pending', 'staged', 'removed']),
      }),
    ),
  })
  .meta({ id: 'MaintenanceExternalFence' })
export const maintenanceExecution = z
  .object({ enabled: z.boolean() })
  .meta({ id: 'MaintenanceExecution' })
export const maintenanceStatus = z
  .object({
    executorAvailable: z.boolean(),
    executorEnabled: z.boolean(),
    restoreHold: z.boolean(),
    lostCleanupHistory: z.boolean(),
    nextRunAt: z.string().nullable(),
    operations: z.array(maintenanceOperation),
    externalFences: z.array(maintenanceExternalFence),
    defaultRule: maintenanceRule,
    rules: z.array(
      maintenanceRule.pick({
        titleId: true,
        enabled: true,
        days: true,
        keepLast: true,
        rosterChanged: true,
      }),
    ),
    rulesEnabled: z.number().int(),
    groups: z.number().int(),
    suppressions: z.array(
      maintenanceEpisode.extend({
        titleId: z.string(),
        status: z.enum(['pending', 'cleaned']),
      }),
    ),
  })
  .meta({ id: 'MaintenanceStatus' })
