import type { CatalogSearchResponse, TitleDetails } from '@torsher/api-client'
import {
  cardOf,
  detailsOf,
  findTitle,
  searchTitles,
} from '@torsher/demo/titles'
import { DemoError, get } from '@torsher/demo/router'

get<CatalogSearchResponse>('/api/catalog/search', ({ query }) => ({
  items: searchTitles(query.get('query') ?? '').map(cardOf),
  people: [],
}))

get<TitleDetails>('/api/catalog/titles/:id', ({ params }) => {
  const title = findTitle(params.id!)
  if (!title)
    throw new DemoError(404, { message: 'Title not found' })

  return detailsOf(title)
})
