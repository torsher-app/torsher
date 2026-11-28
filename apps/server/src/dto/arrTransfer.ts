import type { output } from 'zod'
import { z } from 'zod'

export const ARR_ROW_LIMIT = 1000

const id = z.uuid()
const count = z.number().int().nonnegative()

export const arrConnectionBody = z
  .object({
    kind: z.enum(['sonarr', 'radarr']),
    url: z.string().trim().min(1).max(2048),
  })
  .meta({ id: 'arrConnection' })

export const arrConnection = z
  .object({
    id,
    origin: z.string(),
    addresses: z.array(z.string()),
  })
  .meta({ id: 'arrConnectionResult' })

export const arrPreviewBody = z
  .object({
    connectionId: id,
    approveLan: z.boolean(),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[\x21-\x7E]+$/),
    profileId: z.string().min(1).max(100),
    language: z.enum(['ru-RU', 'en-US']),
  })
  .meta({ id: 'arrPreview' })

export const arrId = z.object({ id })
export const arrPreviewStarted = z
  .object({ id })
  .meta({ id: 'arrPreviewStarted' })

export const arrPreviewRow = z
  .object({
    id,
    sourceTitle: z.string().optional(),
    sourceStatus: z
      .enum(['upcoming', 'continuing', 'ended', 'deleted'])
      .optional(),
    year: z.number().int().optional(),
    title: z.string().optional(),
    selectable: z.boolean(),
    selected: z.boolean(),
    reasons: z.array(
      z.enum([
        'existing',
        'duplicate',
        'unmonitored',
        'no_monitored_seasons',
        'deleted',
        'partial_monitoring',
        'ended',
        'has_file',
        'unknown_file',
        'invalid',
        'unmatched',
        'conflict',
        'tmdb_unavailable',
        'unknown_cursor',
      ]),
    ),
  })
  .meta({ id: 'arrPreviewRow' })

export const arrPreview = z
  .object({
    state: z.enum(['preparing', 'ready']),
    checked: count,
    total: count,
    rows: z.array(arrPreviewRow),
  })
  .meta({ id: 'arrPreviewStatus' })

export const arrApplyBody = z
  .object({
    previewId: id,
    rowIds: z.array(id).min(1).max(ARR_ROW_LIMIT),
  })
  .meta({ id: 'arrApply' })

export const arrApplyResult = z
  .object({
    created: count,
    skipped: count,
    failed: count,
    rows: z.array(
      z.object({
        id,
        outcome: z.enum(['created', 'skipped', 'failed']),
        reason: z.enum(['created', 'existing', 'failed']),
      }),
    ),
  })
  .meta({ id: 'arrApplyResult' })

export const arrErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum([
      'address',
      'address_changed',
      'auth',
      'unsupported',
      'bad_response',
      'limit',
      'expired',
      'profile',
      'busy',
      'request',
    ]),
  })
  .meta({ id: 'arrErrorResponse' })

export type ArrConnectionBody = output<typeof arrConnectionBody>
export type ArrPreviewBody = output<typeof arrPreviewBody>
export type ArrApplyBody = output<typeof arrApplyBody>
export type ArrPreviewRow = output<typeof arrPreviewRow>
export type ArrApplyResult = output<typeof arrApplyResult>
export type ArrErrorKind = output<typeof arrErrorResponse>['kind']
