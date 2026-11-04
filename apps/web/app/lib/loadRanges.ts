import type { OverviewResponse } from '@torsher/api-client'

export type LoadRange = OverviewResponse['load']['historyRange']
export const loadRanges = {
  '1m': { minutes: 1, step: 5000 },
  '15m': { minutes: 15, step: 5000 },
  '1h': { minutes: 60, step: 60_000 },
  '24h': { minutes: 1440, step: 300_000 },
  '7d': { minutes: 10080, step: 1_800_000 },
  '14d': { minutes: 20160, step: 3_600_000 },
} satisfies Record<LoadRange, { minutes: number, step: number }>
