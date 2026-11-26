import { z } from 'zod'
import { subtitleLanguages } from '../services/subtitles/languages.ts'

export const subtitleProvider = z.enum(['opensubtitles', 'subdl'])
const playbackSubtitleProvider = z.enum(['opensubtitles', 'subdl', 'addon'])
const language = z.enum(subtitleLanguages)
const languages = z.array(language)
const nonemptyCredential = z.string().trim().min(1).max(1024)

export const subtitleProviderStatus = z
  .object({
    kind: z.enum(['ready', 'auth', 'unavailable', 'quota']),
    remainingDownloads: z.number().int().nonnegative().optional(),
    remainingSearches: z.number().int().nonnegative().optional(),
    resetAt: z.iso.datetime().optional(),
  })
  .meta({ id: 'subtitleProviderStatus' })

export const subtitleSettings = z
  .object({
    languages,
    openSubtitles: z.object({
      configured: z.boolean(),
      deviceSearch: z.boolean(),
      autoDownload: z.boolean(),
      languages,
      connection: subtitleProviderStatus.optional(),
    }),
    subdl: z.object({
      configured: z.boolean(),
      connection: subtitleProviderStatus.optional(),
    }),
  })
  .meta({ id: 'subtitleSettings' })

export const updateSubtitleSettings = z
  .object({
    openSubtitles: z
      .object({
        apiKey: nonemptyCredential.optional(),
        username: nonemptyCredential.optional(),
        password: z.string().min(1).max(1024).optional(),
        deviceSearch: z.boolean().optional(),
        autoDownload: z.boolean().optional(),
        languages: languages.max(12).optional(),
        disconnect: z.boolean().optional(),
      })
      .optional(),
    subdl: z
      .object({
        apiKey: nonemptyCredential.optional(),
        disconnect: z.boolean().optional(),
      })
      .optional(),
  })
  .meta({ id: 'updateSubtitleSettings' })

export const subtitleSearchContext = z
  .object({
    providers: z.array(playbackSubtitleProvider),
    languages,
    defaultLanguage: language,
    canRemove: z.boolean(),
  })
  .meta({ id: 'subtitleSearchContext' })

export const subtitleSearchInput = z
  .object({ language })
  .meta({ id: 'subtitleSearchInput' })
export const subtitleApplyInput = z
  .object({
    resultId: z.uuid(),
  })
  .meta({ id: 'subtitleApplyInput' })

export const subtitleSearchResponse = z
  .object({
    items: z.array(
      z.object({
        id: z.uuid(),
        provider: playbackSubtitleProvider,
        language,
        addonName: z.string().optional(),
        release: z.string(),
        match: z.enum(['hash', 'release', 'title']),
        forced: z.boolean().optional(),
        hearingImpaired: z.boolean().optional(),
      }),
    ),
    issues: z.array(
      z.object({
        provider: playbackSubtitleProvider,
        kind: z.enum(['unavailable', 'quota', 'auth']),
      }),
    ),
  })
  .meta({ id: 'subtitleSearchResponse' })

export type SubtitleProvider = z.infer<typeof subtitleProvider>
export type SubtitleProviderStatus = z.infer<typeof subtitleProviderStatus>
export type SubtitleSettingsPatch = z.infer<typeof updateSubtitleSettings>
