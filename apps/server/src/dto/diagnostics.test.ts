import { expect, it } from 'vitest'
import { candidateDiagnostics } from './diagnostics.ts'

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
