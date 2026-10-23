import { z } from 'zod'
import { card, tmdbLanguage } from './catalog.ts'

const collectionName = z.string().trim().min(1).max(60)

export const collectionParams = z.object({
  id: z.string().min(1).max(100),
})

export const collectionTitleParams = z.object({
  id: z.string().min(1).max(100),
  titleId: z.string().min(1).max(100),
})

export const collection = z
  .object({
    id: z.string(),
    name: z.string(),
    count: z.number().int(),
    showOnHome: z.boolean(),
    // Профили, от которых подборка скрыта; витрине — всегда пустой
    hiddenFrom: z.array(z.string()),
  })
  .meta({ id: 'collection' })

export const collectionList = z
  .object({
    items: z.array(collection),
  })
  .meta({ id: 'collectionList' })

export const createCollection = z
  .object({
    name: collectionName,
    showOnHome: z.boolean().optional(),
    hiddenFrom: z.array(z.string()).max(100).optional(),
  })
  .meta({ id: 'createCollection' })

export const updateCollection = z
  .object({
    name: collectionName.optional(),
    showOnHome: z.boolean().optional(),
    hiddenFrom: z.array(z.string()).max(100).optional(),
  })
  .meta({ id: 'updateCollection' })

export const collectionTitlesQuery = z.object({
  language: tmdbLanguage,
})

export const collectionTitles = z
  .object({
    items: z.array(card),
  })
  .meta({ id: 'collectionTitles' })

export const collectionErrorResponse = z
  .object({
    message: z.string(),
    kind: z.enum(['duplicate']),
  })
  .meta({ id: 'collectionErrorResponse' })
