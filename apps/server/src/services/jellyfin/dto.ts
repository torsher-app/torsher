import { z } from 'zod'

const bool = z.preprocess(
  value => (typeof value === 'string' ? value.toLowerCase() : value),
  z.union([
    z.boolean(),
    z.enum(['true', 'false']).transform(value => value === 'true'),
  ]),
)
const integer = z.coerce.number().int().nonnegative()
const ticks = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER)
// Clients vary the casing of query names. Normalize once before validation.
export const query = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object')
      return value
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key.toLowerCase(), entry]),
    )
  },
  z
    .object({
      userid: z.string().optional(),
      parentid: z.string().optional(),
      ids: z.string().optional(),
      recursive: bool.optional(),
      includeitemtypes: z.string().optional(),
      excludeitemtypes: z.string().optional(),
      searchterm: z.string().max(500).optional(),
      startindex: integer.default(0),
      limit: integer.max(1000).default(100),
      sortby: z.string().optional(),
      sortorder: z.enum(['Ascending', 'Descending']).optional(),
      filters: z.string().optional(),
      isplayed: bool.optional(),
      isfolder: bool.optional(),
      isfavorite: bool.optional(),
      mediatypes: z.string().optional(),
      mediasourceid: z.string().optional(),
      seriesid: z.string().optional(),
      seasonid: z.string().optional(),
      season: integer.optional(),
      imageindex: integer.optional(),
      static: bool.optional(),
    })
    .passthrough(),
)
export type Query = z.output<typeof query>
export const body = z
  .object({
    Username: z.string().max(256).optional(),
    Pw: z.string().max(4096).optional(),
    UserId: z.string().optional(),
    ItemId: z.string().optional(),
    MediaSourceId: z.string().optional(),
    PositionTicks: ticks.optional(),
    RunTimeTicks: ticks.optional(),
    PlaySessionId: z.string().optional(),
  })
  .passthrough()
  .optional()
export const params = z.record(z.string(), z.string())
