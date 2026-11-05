/** Facts from the existing decision loop, not a second history query. */
export interface EpisodeSkips {
  total: number
  truncated: boolean
  ranges: {
    season: number
    from: number
    to: number
    reason: 'watched' | 'unavailable'
  }[]
}

export function episodeSkips(): EpisodeSkips {
  return { total: 0, truncated: false, ranges: [] }
}

export function skippedEpisode(
  summary: EpisodeSkips,
  ref: { season: number, episode: number },
  reason: 'watched' | 'unavailable',
) {
  summary.total++
  const last = summary.ranges.at(-1)
  if (
    last
    && last.season === ref.season
    && last.reason === reason
    && last.to + 1 === ref.episode
  ) {
    last.to = ref.episode
  }
  else if (summary.ranges.length < 20) {
    summary.ranges.push({
      season: ref.season,
      from: ref.episode,
      to: ref.episode,
      reason,
    })
  }
  else {
    summary.truncated = true
  }
}
