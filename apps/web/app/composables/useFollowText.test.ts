import { describe, expect, it, vi } from 'vitest'
import { useFollowText } from './useFollowText'

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
