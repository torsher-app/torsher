import type { FollowWait, TitleFollow } from '@torsher/api-client'
import { computed } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useFollowTexts } from './useTitleFollow.ts'

const { language } = vi.hoisted(() => ({ language: { value: 'en_US' } }))
vi.mock('vue-i18n', async (original) => {
  const actual = await original<typeof import('vue-i18n')>()
  const { messages } = await import('@torsher/i18n')
  return {
    ...actual,
    useI18n: () =>
      actual.createI18n({ legacy: false, locale: language.value, messages })
        .global,
  }
})
vi.mock('../api.ts', () => ({ api: {} }))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => computed(() => language.value.replace('_', '-')),
}))

const wait: FollowWait = {
  until: '2026-11-09T12:00:00Z',
  quality: '1080p',
  studio: 'Studio B',
  candidate: { quality: '720p', studio: 'Studio A', language: 'original' },
}

describe.each(['en_US', 'ru_RU'])('waiting text in %s', (locale) => {
  function follow(movie = false): TitleFollow {
    return {
      state: 'active',
      kind: movie ? 'movie' : 'series',
      counts: {},
      first: {},
      quality: { value: '1080p', lowered: false },
      waiting: { ...wait, season: movie ? 0 : 2, episode: movie ? 0 : 8 },
    } as TitleFollow
  }
  it('shows the held version and the preferred version on the title', () => {
    language.value = locale
    const text = useFollowTexts().statusLine(follow())
    for (const part of ['S2E8', 'Studio A', 'Studio B', '720p', '1080p'])
      expect(text).toContain(part)
    expect(text).toContain(locale === 'en_US' ? 'found' : 'найдено')
    expect(text).not.toContain('audioLanguages.')
    expect(useFollowTexts().statusLine(follow(true))).not.toContain('S0E0')
  })
  it('keeps partial candidates and older server snapshots readable', () => {
    language.value = locale
    const item = follow()
    item.waiting = {
      season: 2,
      episode: 8,
      until: wait.until,
      candidate: { quality: '720p' },
    }
    expect(useFollowTexts().statusLine(item)).toContain('720p')
    delete item.waiting.candidate
    expect(useFollowTexts().statusLine(item)).not.toContain('720p')
    expect(useFollowTexts().statusLine(item)).not.toContain('undefined')
  })
  it('shows known candidate facts and the deadline on the episode', () => {
    language.value = locale
    const texts = useFollowTexts()
    expect(texts.episodeState('waiting', wait)).toContain('720p')
    expect(texts.episodeState('waiting', wait)).toContain('1080p')
    expect(texts.episodeState('waiting', wait)).toContain(
      locale === 'en_US' ? 'until' : 'до',
    )
    expect(texts.episodeState('waiting')).not.toContain('undefined')
    expect(texts.episodeState('waiting', { until: wait.until })).not.toContain(
      'found',
    )
  })
})
