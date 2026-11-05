import { describe, expect, it } from 'vitest'
import { followVoiceBody, followVoiceError } from './followVoiceRules'

describe('follow voice form adapter', () => {
  it('does not migrate legacy or send old fields when another rule changes', () => {
    const saved = { voiceStudio: null, voiceStrict: true }
    expect(
      followVoiceBody(saved, {
        voiceMode: 'legacy',
        voiceStudio: '',
        voiceStrict: true,
      }),
    ).toEqual({})
    expect(
      followVoiceBody(
        {
          ...saved,
          voicePolicy: { mode: 'legacy', studio: null, strict: true },
        },
        { voiceMode: 'legacy' },
      ),
    ).toEqual({})
  })
  it('sends the canonical explicit studio atomically', () => {
    expect(
      followVoiceBody(
        {
          voicePolicy: { mode: 'auto' },
          voiceStudio: null,
          voiceStrict: false,
        },
        { voiceMode: 'only', voiceStudio: ' HDRezka ' },
      ),
    ).toEqual({ voicePolicy: { mode: 'only', studio: 'HDRezka Studio' } })
  })
  it('expresses any even when the old pair is already null and false', () => {
    expect(
      followVoiceBody(
        {
          voicePolicy: { mode: 'auto' },
          voiceStudio: null,
          voiceStrict: false,
        },
        { voiceMode: 'any' },
      ),
    ).toEqual({ voicePolicy: { mode: 'any' } })
  })
  it('uses legacy fields only for a changed legacy choice', () => {
    expect(
      followVoiceBody(
        { voiceStudio: 'Studio A', voiceStrict: false },
        { voiceMode: 'legacy', voiceStudio: 'Studio B', voiceStrict: true },
      ),
    ).toEqual({ voiceStudio: 'Studio B', voiceStrict: true })
  })
})

describe('modern studio validation', () => {
  const modern = { voicePolicy: { mode: 'auto' as const } }
  it.each(['prefer', 'only'] as const)(
    'rejects unknown or empty studios for %s',
    (voiceMode) => {
      expect(followVoiceError(modern, { voiceMode, voiceStudio: 'RHS' })).toBe(
        'unknown',
      )
      expect(
        followVoiceError(modern, { voiceMode, voiceStudio: 'HDRezka typo' }),
      ).toBe('unknown')
      expect(followVoiceError(modern, { voiceMode, voiceStudio: '  ' })).toBe(
        'required',
      )
    },
  )
  it.each([
    ['HDRezka', 'HDRezka Studio'],
    ['RedHeadSound', 'Red Head Sound'],
  ])('accepts and canonicalizes %s', (alias, studio) => {
    const form = { voiceMode: 'only' as const, voiceStudio: alias }
    expect(followVoiceError(modern, form)).toBeUndefined()
    expect(
      followVoiceBody(
        { ...modern, voiceStudio: null, voiceStrict: false },
        form,
      ),
    ).toEqual({ voicePolicy: { mode: 'only', studio } })
  })
  it('leaves legacy unknown names and inactive studio fields alone', () => {
    expect(
      followVoiceError(
        {},
        { voiceMode: 'only', voiceStudio: 'Unknown legacy studio' },
      ),
    ).toBeUndefined()
    expect(
      followVoiceError(
        {
          voicePolicy: {
            mode: 'legacy',
            studio: 'Unknown legacy studio',
            strict: true,
          },
        },
        { voiceMode: 'legacy', voiceStudio: 'Unknown legacy studio' },
      ),
    ).toBeUndefined()
    expect(
      followVoiceError(modern, {
        voiceMode: 'any',
        voiceStudio: 'Unknown legacy studio',
      }),
    ).toBeUndefined()
  })
})

it('allows fictional demo list choices only in demo list mode', () => {
  const follow = { voicePolicy: { mode: 'auto' as const } }
  const form = { voiceMode: 'only' as const, voiceStudio: 'Demo Voices' }
  const selection = {
    demo: true,
    manual: false,
    items: [{ studio: 'Demo Voices' }],
  }
  expect(followVoiceError(follow, form, selection)).toBeUndefined()
  expect(followVoiceError(follow, form, { ...selection, demo: false })).toBe(
    'unknown',
  )
  expect(followVoiceError(follow, form, { ...selection, manual: true })).toBe(
    'unknown',
  )
  expect(
    followVoiceError(
      follow,
      { ...form, voiceStudio: 'Demo Voices typo' },
      selection,
    ),
  ).toBe('unknown')
})
