import { z } from 'zod'

const scope = z.enum(['read', 'write'])

export const simklDeviceInput = z.object({ scope }).meta({ id: 'simklDeviceInput' })

export const simklDirectionsInput = z.object({
  expectedGeneration: z.uuid(),
  pull: z.boolean(),
  push: z.boolean(),
}).meta({ id: 'simklDirectionsInput' })

export const simklSyncInput = z.object({
  mode: z.enum(['auto', 'manual', 'full']),
}).meta({ id: 'simklSyncInput' })

const count = z.int().nonnegative()
const instant = z.iso.datetime()

export const simklStatus = z.object({
  available: z.boolean(),
  connection: z.object({
    generation: z.uuid(),
    account: z.string(),
    scope,
    pull: z.boolean(),
    push: z.boolean(),
    reauthorize: z.boolean(),
  }).nullable(),
  challenge: z.object({
    scope,
    userCode: z.string(),
    verificationUri: z.string(),
    expiresAt: instant,
    nextPollAt: instant,
  }).nullable(),
  syncing: z.boolean(),
  syncError: z.boolean(),
  lastSyncAt: instant.nullable(),
  pending: count,
  issues: count,
  skipped: count,
  revokeWarning: z.boolean(),
}).meta({ id: 'simklStatus' })

export const simklError = z.object({
  kind: z.enum([
    'unavailable',
    'profile',
    'busy',
    'identity',
    'scope',
    'expired',
    'denied',
    'provider',
  ]),
}).meta({ id: 'simklError' })

export type SimklErrorKind = z.infer<typeof simklError>['kind']
export type SimklScope = z.infer<typeof scope>
export type SimklStatus = z.infer<typeof simklStatus>
