import { describe, expect, it, vi } from 'vitest'
import { useFollowText } from './useFollowText'
import type { FollowSummary } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'

vi.mock('vue-i18n', async (original) => {
  const { createI18n } = await original<typeof import('vue-i18n')>()
  const { messages } = await import('@torsher/i18n')
  const i18n = createI18n({ legacy: false, locale: 'en_US', messages })
  return { useI18n: () => i18n.global }
})

const base = {
  mode: 'download',
  audioEffective: 'ru',
  voiceStudio: 'Old studio',
  voiceStrict: true,
  qualityPreset: 'best',
  waitHours: 24,
} as const

describe('follow policy summary', () => {
  it.each([
    [{ mode: 'auto' }, 'Automatic'],
    [{ mode: 'any' }, 'Any studio'],
    [{ mode: 'legacy', studio: null, strict: true }, 'Previous rule'],
    [{ mode: 'prefer', studio: 'Studio B' }, 'Prefer Studio B'],
    [{ mode: 'only', studio: 'Studio B' }, 'Only Studio B'],
  ] as const)(
    'shows the saved policy %o, without replacing it with old fields',
    (voicePolicy, expected) => {
      const text = useFollowText().policy({ ...base, voicePolicy })
      expect(text.split(' · ')[1]).toBe(expected)
      expect(text).not.toContain('Old studio')
    },
  )

  it('keeps the effective language while the studio rule is inactive', () => {
    expect(
      useFollowText()
        .policy({
          ...base,
          audioEffective: 'de',
          voicePolicy: { mode: 'only', studio: 'Studio B' },
        })
        .split(' · ')[1],
    ).toBe('German')
  })

  it('preserves the old-server summary when voicePolicy is absent', () => {
    const { policy } = useFollowText()
    expect(policy(base).split(' · ')[1]).toContain('Old studio')
    expect(
      policy({ ...base, voiceStudio: null, voiceStrict: false }).split(
        ' · ',
      )[1],
    ).toBe('Any voice-over')
  })
})

describe.each(['en_US', 'ru_RU'])('waiting status in %s', (locale) => {
  function waiting(kind: 'series' | 'movie' = 'series'): FollowSummary {
    return {
      kind,
      waitUntil: '2026-11-09T12:00:00Z',
      waiting: {
        season: kind === 'series' ? 2 : 0,
        episode: kind === 'series' ? 8 : 0,
        until: '2026-11-09T12:00:00Z',
        quality: '1080p',
        studio: 'Studio B',
        candidate: {
          quality: '720p',
          studio: 'Studio A',
          language: 'original',
        },
      },
    } as FollowSummary
  }
  function text(follow = waiting()) {
    useI18n().locale.value = locale
    return useFollowText().status(follow, {
      status: 'waiting',
      count: 1,
    } as Parameters<ReturnType<typeof useFollowText>['status']>[1])
  }
  it('names the episode, actual version, target and deadline', () => {
    const value = text()
    for (const part of ['S2E8', '720p', '1080p', 'Studio A', 'Studio B'])
      expect(value).toContain(part)
    expect(value).toContain(locale === 'en_US' ? 'found' : 'найдено')
    expect(value).not.toContain('audioLanguages.')
  })
  it('does not name a movie S0E0 or invent missing facts', () => {
    const follow = waiting('movie')
    expect(text(follow)).not.toContain('S0E0')
    follow.waiting!.candidate = {}
    expect(text(follow)).not.toContain(
      locale === 'en_US' ? 'found' : 'найдено',
    )
  })
  it('shows a partial candidate without inventing a target', () => {
    const follow = waiting()
    follow.waiting = {
      season: 2,
      episode: 8,
      until: follow.waitUntil!,
      candidate: { quality: '720p' },
    }
    expect(text(follow)).toContain('720p')
    expect(text(follow)).not.toContain('1080p')
    expect(text(follow)).not.toContain('Studio')
  })
  it('preserves the waitUntil fallback for an older server', () => {
    const follow = waiting()
    delete follow.waiting
    expect(text(follow)).toContain(useFollowText().until(follow.waitUntil!))
    expect(text(follow)).not.toContain('Studio')
  })
})
