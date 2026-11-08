import type {
  FollowSummary,
  FollowVoicesResponse,
  UpdateFollowInput,
} from '@torsher/api-client'
import type { Studio } from '@torsher/release-parser/studio-search'
import { studioKey, studios } from '@torsher/release-parser/studio-search'

export function canonicalStudio(value: string, collection: readonly Studio[]) {
  return collection.find(studio =>
    [studio.name, ...(studio.aliases ?? [])].some(
      name => studioKey(name) === studioKey(value),
    ),
  )?.name
}

interface VoiceForm {
  voiceMode?: NonNullable<FollowSummary['voicePolicy']>['mode']
  voiceStudio?: string
  voiceStrict?: boolean
}

/** Validate modern studio choices without changing unknown legacy rows. */
export function followVoiceError(
  follow: Pick<FollowSummary, 'voicePolicy'>,
  form: VoiceForm,
  collection: readonly Studio[] = studios,
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
  return canonicalStudio(studio, collection) ? undefined : 'unknown'
}

/** Form state is separate from the transport policy; legacy stays untouched until edited. */
export function followVoiceBody(
  follow: Pick<FollowSummary, 'voicePolicy' | 'voiceStudio' | 'voiceStrict'>,
  form: VoiceForm,
  collection: readonly Studio[] = studios,
): Pick<UpdateFollowInput, 'voicePolicy' | 'voiceStudio' | 'voiceStrict'> {
  const studio = form.voiceStudio?.trim() ?? ''
  if (follow.voicePolicy !== undefined) {
    if (form.voiceMode === 'prefer' || form.voiceMode === 'only') {
      return {
        voicePolicy: {
          mode: form.voiceMode,
          studio: canonicalStudio(studio, collection) ?? studio,
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

/** Alias rows may overlap the same releases: retain flags and the largest count. */
export function mergeStudioEvidence(
  items: FollowVoicesResponse['items'],
  collection: readonly Studio[],
) {
  const merged = new Map<string, FollowVoicesResponse['items'][number]>()
  for (const item of items) {
    const name = canonicalStudio(item.studio, collection)
    if (!name)
      continue
    const previous = merged.get(name)
    merged.set(
      name,
      previous
        ? {
            ...previous,
            found: previous.found || item.found,
            saved: previous.saved || item.saved,
            inherited: previous.inherited || item.inherited,
            count: Math.max(previous.count, item.count),
            seeders: Math.max(previous.seeders, item.seeders),
            types: [...new Set([...previous.types, ...item.types])],
          }
        : { ...item, studio: name },
    )
  }
  return merged
}
