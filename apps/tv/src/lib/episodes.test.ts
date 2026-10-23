import type { SourceCandidate } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { coversEpisode, episodeCandidates, lastVoiceKey } from './episodes.ts'

function candidate(
  id: string,
  extra: Partial<SourceCandidate> = {},
): SourceCandidate {
  return {
    id,
    title: id,
    indexers: [],
    size: null,
    episodeSize: null,
    seeders: 10,
    peers: null,
    quality: '1080p',
    source: null,
    codec: null,
    hdr: [],
    audio: [],
    channels: null,
    subs: [],
    voice: null,
    voiceKeys: [],
    seasons: [2],
    episodes: null,
    isPack: true,
    confidence: 'high',
    pickReason: null,
    publishedAt: null,
    lastWatched: false,
    ...extra,
  }
}

describe('coversEpisode', () => {
  it('пак — весь сезон, диапазон — только свои серии', () => {
    expect(coversEpisode(candidate('a'), 2, 7)).toBe(true)
    expect(
      coversEpisode(candidate('b', { episodes: { from: 1, to: 4 } }), 2, 5),
    ).toBe(false)
    expect(coversEpisode(candidate('c', { seasons: [1] }), 2, 1)).toBe(false)
  })
})

describe('episodeCandidates', () => {
  it('сначала та же озвучка, дальше порядок сервера, не больше трёх', () => {
    const list = [
      candidate('best'),
      candidate('other-season', { seasons: [1] }),
      candidate('unsure', { confidence: 'medium' }),
      candidate('same', { voiceKeys: ['studio:LostFilm'] }),
      candidate('third'),
      candidate('fourth'),
    ]

    expect(
      episodeCandidates(list, { season: 2, episode: 3 }, 'studio:LostFilm').map(
        item => item.id,
      ),
    ).toEqual(['same', 'best', 'third'])
  })
})

describe('lastVoiceKey', () => {
  it('озвучка этого сезона, иначе ближайшего прошлого', () => {
    const releases = [
      {
        season: 1,
        torrentId: 'a',
        quality: null,
        voice: { studio: 'Kubik' },
        episodes: [],
      },
      {
        season: 2,
        torrentId: 'b',
        quality: null,
        voice: { type: 'MVO' as const },
        episodes: [],
      },
    ]

    expect(lastVoiceKey(releases, 2)).toBe('type:MVO')
    expect(lastVoiceKey(releases, 3)).toBe('type:MVO')
    expect(lastVoiceKey(releases.slice(0, 1), 3)).toBe('studio:Kubik')
    expect(lastVoiceKey([], 1)).toBeUndefined()
  })
})
