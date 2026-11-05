import type {
  FollowSummary,
  FollowVoicesResponse,
  UpdateFollowInput,
} from '@torsher/api-client'
import { findStudio } from '@torsher/release-parser'

interface VoiceForm {
  voiceMode?: NonNullable<FollowSummary['voicePolicy']>['mode']
  voiceStudio?: string
  voiceStrict?: boolean
}

/** Validate modern studio choices without changing unknown legacy rows. */
export function followVoiceError(
  follow: Pick<FollowSummary, 'voicePolicy'>,
  form: VoiceForm,
  demoSelection?: {
    demo: boolean
    manual: boolean
    items: Pick<FollowVoicesResponse['items'][number], 'studio'>[]
  },
): 'required' | 'unknown' | undefined {
  if (
    follow.voicePolicy === undefined
    || (form.voiceMode !== 'prefer' && form.voiceMode !== 'only')
  ) {
    return undefined
  }
  const studio = form.voiceStudio?.trim() ?? ''
  if (!studio)
    return 'required'
  if (
    demoSelection?.demo
    && !demoSelection.manual
    && demoSelection.items.some(item => item.studio === studio)
  ) {
    return undefined
  }
  return findStudio(studio) ? undefined : 'unknown'
}

/** Form state is separate from the transport policy; legacy stays untouched until edited. */
export function followVoiceBody(
  follow: Pick<FollowSummary, 'voicePolicy' | 'voiceStudio' | 'voiceStrict'>,
  form: VoiceForm,
): Pick<UpdateFollowInput, 'voicePolicy' | 'voiceStudio' | 'voiceStrict'> {
  const studio = form.voiceStudio?.trim() ?? ''
  if (follow.voicePolicy !== undefined) {
    if (form.voiceMode === 'prefer' || form.voiceMode === 'only') {
      return {
        voicePolicy: {
          mode: form.voiceMode,
          studio: findStudio(studio)?.name ?? studio,
        },
      }
    }
    if (form.voiceMode === 'auto' || form.voiceMode === 'any')
      return { voicePolicy: { mode: form.voiceMode } }
    return {}
  }
  if (
    studio !== (follow.voiceStudio ?? '')
    || form.voiceStrict !== follow.voiceStrict
  ) {
    return {
      voiceStudio: studio || null,
      voiceStrict: !!studio && !!form.voiceStrict,
    }
  }
  return {}
}
