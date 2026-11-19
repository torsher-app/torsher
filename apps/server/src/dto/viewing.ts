import { z } from 'zod'
import { viewingAttemptStates } from '../db/schema.ts'

const identity = z.string().min(1).max(100)

const startIdentity = {
  requestId: identity,
  playerId: identity,
  clientId: identity,
  cycleId: z.uuid().optional(),
}

export const viewingStart = z
  .discriminatedUnion('intent', [
    z.strictObject({
      ...startIdentity,
      intent: z.literal('join'),
      expectedGeneration: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
    }),
    z.strictObject({
      ...startIdentity,
      intent: z.literal('restart'),
      expectedGeneration: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
    }),
  ])
  .meta({ id: 'viewingStart' })

export const viewingAttempt = z
  .object({
    attemptId: z.uuid(),
    generation: z.number().int().positive(),
    state: z.enum(viewingAttemptStates),
    current: z.boolean().optional(),
  })
  .meta({ id: 'viewingAttempt' })

export const viewingCheckpoint = z
  .strictObject({
    playerId: identity,
    line: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    kind: z.enum(['playback', 'seek', 'pause', 'stop', 'source_switch']),
  })
  .meta({ id: 'viewingCheckpoint' })

export const viewingAttemptQuery = z.object({
  titleId: identity,
  season: z.coerce.number().int().min(0).max(999).optional(),
  episode: z.coerce.number().int().min(1).max(9999).optional(),
  cycleId: z.uuid().optional(),
  profileId: identity.optional(),
})

export const viewingAttemptResponse = z
  .object({
    attempt: viewingAttempt.nullable(),
    source: z
      .union([
        z.object({
          torrentId: identity,
          fileIndex: z.number().int().nonnegative(),
        }),
        z.object({ mediaFileId: identity }),
      ])
      .optional(),
    voiceStudio: z.string().optional(),
  })
  .meta({ id: 'viewingAttemptResponse' })

export type ViewingStart = z.infer<typeof viewingStart>
export type ViewingCheckpoint = z.infer<typeof viewingCheckpoint>
