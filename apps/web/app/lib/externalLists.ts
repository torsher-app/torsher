import { getErrorBody } from '@torsher/api-client'
import type { api } from '~/services/api'

export type ExternalLists = Awaited<
  ReturnType<typeof api.settings.getExternalLists>
>
export type ExternalList = ExternalLists['lists'][number]
export type ExternalListInput = Parameters<
  typeof api.settings.startExternalListPreview
>[0]
export type ExternalListPreviewResponse = Awaited<
  ReturnType<typeof api.settings.getExternalListPreview>
>
export type ExternalListPreview = NonNullable<
  ExternalListPreviewResponse['preview']
>
export type ExternalListCounts = ExternalListPreview['counts']
export type ExternalListExclusions = Awaited<
  ReturnType<typeof api.settings.getExternalListExclusions>
>

export const externalListsKey = 'panel.settings.externalLists'
export const externalListMedia = ['all', 'movie', 'tv'] as const
export const externalListIntervals = [12, 24, 48] as const

const errors = [
  'keyRequired',
  'keyRejected',
  'sourceUnavailable',
  'sourceAmbiguous',
  'sourceTooLarge',
  'listLimit',
  'duplicate',
  'retryLater',
  'previewExpired',
]

export function externalListErrorKey(code: string | null | undefined) {
  if (code === 'invalidSource')
    return `${externalListsKey}.errors.sourceUnavailable`

  return `${externalListsKey}.errors.${code && errors.includes(code) ? code : 'generic'}`
}

export async function externalListRequestError(error: unknown) {
  const body = await getErrorBody<{ message?: string }>(error)
  return externalListErrorKey(body?.message)
}
