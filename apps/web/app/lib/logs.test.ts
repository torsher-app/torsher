import type { LogEntry } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import {
  duplicateDiagnosticEvents,
  LOG_ID_KEYS,
  logSourceLabels,
} from './logs'

function entry(id: number, eventId: string, clientSeq: number): LogEntry {
  return {
    id,
    seq: id,
    source: 'client',
    level: 'info',
    time: '2026-11-05T00:00:00Z',
    message: 'Client event',
    context: { eventId, clientSeq },
  }
}
describe('client journal correlation', () => {
  it('marks repeated delivery by event identity, not by action or arrival order', () => {
    const rows = [
      entry(3, 'session-001:2', 2),
      entry(2, 'session-001:1', 1),
      entry(1, 'session-001:2', 2),
    ]
    expect([...duplicateDiagnosticEvents(rows)]).toEqual([3])
    expect(rows.map(item => item.context!.clientSeq)).toEqual([2, 1, 2])
  })
  it('exposes client and server correlation ids in the existing detail sheet', () => {
    expect(logSourceLabels.client).toBe('panel.logs.sources.client')
    for (const key of [
      'actionId',
      'parentActionId',
      'eventId',
      'requestId',
      'reportedRequestId',
      'clientRequestId',
      'clientSessionId',
      'profileId',
      'decisionId',
      'rankingDecisionId',
    ])
      expect(LOG_ID_KEYS.has(key)).toBe(true)
  })
})
