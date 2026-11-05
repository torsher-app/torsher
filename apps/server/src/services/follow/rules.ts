import { findStudio } from '@torsher/release-parser'
import type { Follow } from '../../db/schema.ts'
import type { FollowRules } from './index.ts'

export class InvalidVoicePolicyError extends Error {
  statusCode = 400
}

/** Modern policy is atomic; unchanged legacy full forms preserve it. */
export function normalizeRules(input: FollowRules = {}, current?: Follow) {
  const { voicePolicy, ...rest } = input
  const rules = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as Omit<FollowRules, 'voicePolicy'> & { voiceMode?: Follow['voiceMode'] }
  if (voicePolicy) {
    const studio
      = 'studio' in voicePolicy
        ? findStudio(voicePolicy.studio.trim())?.name
        : null
    if (studio === undefined)
      throw new InvalidVoicePolicyError('Unknown voice studio')
    const legacyStudio = rules.voiceStudio
      ? (findStudio(rules.voiceStudio)?.name ?? rules.voiceStudio)
      : rules.voiceStudio
    const strict = voicePolicy.mode === 'only'
    if (
      (legacyStudio !== undefined && legacyStudio !== studio)
      || (rules.voiceStrict !== undefined && rules.voiceStrict !== strict)
    ) {
      throw new InvalidVoicePolicyError('Conflicting voice policy')
    }
    return {
      ...rules,
      voiceMode: voicePolicy.mode,
      voiceStudio: studio,
      voiceStrict: strict,
    }
  }
  if (rules.voiceStudio !== undefined || rules.voiceStrict !== undefined) {
    const studio
      = rules.voiceStudio !== undefined
        ? rules.voiceStudio
        : (current?.voiceStudio ?? null)
    const strict = rules.voiceStrict ?? current?.voiceStrict ?? false
    // Old full forms, including unknown legacy names, are not new intent.
    if (
      current
      && studio === current.voiceStudio
      && strict === current.voiceStrict
    ) {
      return rules
    }
    const canonical = studio ? findStudio(studio)?.name : undefined
    if (studio)
      rules.voiceStudio = canonical ?? studio
    if (
      current
      && rules.voiceStudio === current.voiceStudio
      && strict === current.voiceStrict
    ) {
      return rules
    }
    // Unknown names are accepted only by the legacy pair contract. Do not
    // advertise them as a validated modern policy that the parser cannot match.
    rules.voiceMode = studio
      ? canonical
        ? strict
          ? 'only'
          : 'prefer'
        : null
      : strict
        ? null
        : 'any'
  }
  return rules
}
