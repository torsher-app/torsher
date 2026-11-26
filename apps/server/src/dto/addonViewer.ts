import { z } from 'zod'
import { card, tmdbLanguage } from './catalog.ts'
import { homeModes } from './home.ts'
import { httpAddonType } from './httpAddons.ts'
import { resolutions } from './titles.ts'

export const addonSourceQuery = z
  .object({
    season: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,2})$/)
      .optional(),
    episode: z
      .string()
      .regex(/^[1-9]\d{0,3}$/)
      .optional(),
    language: tmdbLanguage,
  })
  .refine(
    value => (value.season === undefined) === (value.episode === undefined),
  )

const addonSource = z
  .object({
    id: z.uuid(),
    kind: z.enum(['torrent', 'http']),
    addonName: z.string(),
    name: z.string(),
    quality: z.enum(resolutions).nullable(),
  })
  .meta({ id: 'addonSource' })

export const addonSources = z
  .object({
    items: z.array(addonSource),
    failed: z.boolean(),
  })
  .meta({ id: 'addonSources' })

export const playHttpAddonSource = z
  .object({
    candidateId: z.uuid(),
  })
  .meta({ id: 'playHttpAddonSource' })

export const addonSourcePlayback = z
  .union([
    z.object({ kind: z.literal('http'), launchId: z.uuid() }),
    z.object({
      kind: z.literal('torrent'),
      status: z.enum(['resolving', 'files']),
      torrentId: z.string(),
    }),
    z.object({
      kind: z.literal('torrent'),
      status: z.literal('ready'),
      torrentId: z.string(),
      fileIndex: z.number().int().nonnegative(),
    }),
  ])
  .meta({ id: 'addonSourcePlayback' })

export type AddonSourcePlayback = z.output<typeof addonSourcePlayback>

export const addonHomeQuery = z.object({
  mode: z.enum(homeModes).default('all'),
  language: tmdbLanguage,
})

const addonCatalogRow = z
  .object({
    id: z.string(),
    kind: z.literal('addon'),
    name: z.string(),
    type: httpAddonType,
    items: z.array(card),
  })
  .meta({ id: 'addonCatalogRow' })

export const addonCatalogRows = z
  .object({
    rows: z.array(addonCatalogRow),
    failed: z.boolean(),
  })
  .meta({ id: 'addonCatalogRows' })
