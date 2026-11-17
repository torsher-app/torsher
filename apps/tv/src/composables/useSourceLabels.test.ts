import type { TitleProgress } from '@torsher/api-client'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSourceLabels } from './useSourceLabels.ts'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref('en') }),
}))

function progress(
  source?: NonNullable<TitleProgress['last']>['source'],
): TitleProgress {
  return {
    resume: null,
    episodes: [],
    last: {
      season: 1,
      episode: 4,
      position: 15,
      duration: 15,
      watched: true,
      updatedAt: '',
      ...(source !== undefined ? { source } : {}),
    },
    seasonReleases: [
      {
        season: 1,
        torrentId: 'future',
        quality: '1080p',
        voice: { studio: 'Other' },
        episodes: [5],
      },
    ],
  }
}

describe('last-file history labels', () => {
  it('keeps episode quality, voice and source together on both history consumers', () => {
    expect(
      useSourceLabels().historyOf(
        progress({
          torrentId: 'watched',
          quality: 'SD',
          voice: { studio: 'Original' },
        }),
      ),
    ).toEqual({
      line: 'S1E4 · SD · Original',
      torrentId: 'watched',
      season: 1,
      episode: 4,
    })
  })
  it('does not substitute aggregate quality for unknown or unavailable exact metadata', () => {
    expect(
      useSourceLabels().historyOf(
        progress({ torrentId: null, quality: null, voice: null }),
      )?.line,
    ).toBe('S1E4')
    expect(useSourceLabels().historyOf(progress(null))?.line).toBe('S1E4')
  })
  it('retains compatibility with servers predating exact-file metadata', () => {
    expect(useSourceLabels().historyOf(progress())?.line).toBe(
      'S1E4 · 1080p · Other',
    )
  })
})
