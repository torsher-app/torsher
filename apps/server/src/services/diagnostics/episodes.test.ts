import { expect, it } from 'vitest'
import { episodeSkips, skippedEpisode } from './episodes.ts'

it('bounds disjoint ranges while counting all skipped episodes', () => {
  const summary = episodeSkips()
  for (let episode = 1; episode <= 50; episode += 2)
    skippedEpisode(summary, { season: 1, episode }, 'unavailable')
  expect(summary.total).toBe(25)
  expect(summary.ranges).toHaveLength(20)
  expect(summary.truncated).toBe(true)
})
