import { z } from 'zod'
import { followAudios } from '../db/schema.ts'

const qualities = z
  .array(z.enum(['1080p', '2160p', '720p', 'SD']))
  .length(4)
  .refine(value => new Set(value).size === 4, 'Qualities must be unique')
const voiceTypes = z
  .array(z.enum(['D', 'MVO', 'DVO', 'AVO', 'VO', 'L']))
  .refine(
    value =>
      value.length === 0 || (value.length === 6 && new Set(value).size === 6),
    'Voice types must be empty or a full unique order',
  )

const audioLanguages = z
  .array(z.enum(followAudios))
  .min(1)
  .max(followAudios.length)
  .refine(
    value => new Set(value).size === value.length,
    'Languages must be unique',
  )

const name = z.string().trim().min(1).max(64)
export const sourcePresetParams = z.object({
  presetId: z.string().min(1).max(100),
})
export const sourcePreset = z
  .object({ id: z.string(), name, qualities, voiceTypes, audioLanguages })
  .meta({ id: 'sourcePreset' })
export const sourceSettings = z
  .object({ defaultPresetId: z.string(), presets: z.array(sourcePreset) })
  .meta({ id: 'sourceSettings' })
export const updateSourceSettings = z
  .object({ defaultPresetId: z.string().min(1).max(100) })
  .meta({ id: 'updateSourceSettings' })
export const createSourcePreset = z
  .object({ name })
  .meta({ id: 'createSourcePreset' })
export const updateSourcePreset = z
  .object({
    audioLanguages: audioLanguages.optional(),
    name: name.optional(),
    makeDefault: z.boolean().optional(),
    qualities: qualities.optional(),
    voiceTypes: voiceTypes.optional(),
  })
  .meta({ id: 'updateSourcePreset' })
