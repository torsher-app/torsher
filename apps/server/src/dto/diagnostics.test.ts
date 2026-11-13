import { expect, it } from 'vitest'
import {
  candidateDiagnostics,
  diagnosticPlaybackNetwork,
} from './diagnostics.ts'

it('preserves ranker sentinel priorities for candidates without an audio preference', () => {
  const facts = {
    rank: 4,
    score: 0,
    audioPriority: Number.MAX_SAFE_INTEGER,
    typePriority: Number.MAX_SAFE_INTEGER,
  }
  expect(candidateDiagnostics.parse(facts)).toEqual(facts)
  expect(
    candidateDiagnostics.safeParse({
      ...facts,
      audioPriority: Number.MAX_SAFE_INTEGER + 1,
    }).success,
  ).toBe(false)
})

it('bounds network observations and rejects free text at every nested boundary', () => {
  const base = {
    stats: { state: 'unavailable' },
    clientBuffer: { state: 'unknown' },
  }
  expect(diagnosticPlaybackNetwork.safeParse(base).success).toBe(true)
  for (const extra of [
    { ...base, url: 'SECRET' },
    { ...base, stats: { ...base.stats, url: 'SECRET' } },
    { ...base, clientBuffer: { ...base.clientBuffer, raw: 'SECRET' } },
    { ...base, stats: { ...base.stats, peersConnected: -1 } },
    { ...base, stats: { ...base.stats, peersFound: 1_000_001 } },
    {
      ...base,
      stats: { ...base.stats, bufferedAheadBytes: Number.MAX_SAFE_INTEGER + 1 },
    },
    { ...base, stats: { ...base.stats, downloadBytesPerSecond: Infinity } },
    { ...base, clientBuffer: { state: 'available', aheadSeconds: NaN } },
  ]) {
    expect(diagnosticPlaybackNetwork.safeParse(extra).success).toBe(false)
  }
})
