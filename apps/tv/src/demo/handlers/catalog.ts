import type {
  CatalogBackdropsResponse,
  CatalogDiscoverResponse,
  CatalogGenresResponse,
  CatalogSearchResponse,
  CatalogTrendingResponse,
  Person,
  PersonCredit,
  PersonDetails,
  SeasonDetails,
  TitleDetails,
  TitleExtras,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import { DemoError, get } from '@torsher/demo/router'
import { extrasOf, searchTitles, TITLES } from '@torsher/demo/titles'
import { backdropFor } from '../art.ts'
import {
  cardFor,
  cardsOf,
  detailsFor,
  extrasFor,
  genreTag,
  seasonFor,
  titleById,
} from '../cards.ts'
import { statusOf } from '../viewer.ts'
import { TRENDING } from './home.ts'

const PAGE_SIZE = 20

get<TitleDetails>('/api/catalog/titles/:id', ({ params }) =>
  detailsFor(titleById(params.id!)))

get<TitleExtras>('/api/catalog/titles/:id/extras', ({ params }) =>
  extrasFor(titleById(params.id!)))

get<SeasonDetails>('/api/catalog/titles/:id/seasons/:number', ({ params }) =>
  seasonFor(titleById(params.id!), Number(params.number)))

type CatalogType = 'movies' | 'series' | 'cartoons' | 'cartoonSeries' | 'anime'

/** Тип каталога: мультфильмы — анимация, аниме в выдуманном каталоге нет */
function ofType(type: string | null) {
  const animated = (title: DemoTitle) => title.genres.includes('Animation')

  switch (type as CatalogType | null) {
    case 'series':
      return TITLES.filter(
        title => title.kind === 'series' && !animated(title),
      )
    case 'cartoons':
      return TITLES.filter(
        title => title.kind === 'movie' && animated(title),
      )
    case 'cartoonSeries':
      return TITLES.filter(
        title => title.kind === 'series' && animated(title),
      )
    case 'anime':
      return []
    default:
      return TITLES.filter(
        title => title.kind === 'movie' && !animated(title),
      )
  }
}

get<CatalogGenresResponse>('/api/catalog/genres', ({ query }) => {
  const names = new Set(
    ofType(query.get('type')).flatMap(title => title.genres),
  )

  return { items: [...names].sort().map(genreTag) }
})

get<CatalogDiscoverResponse>('/api/catalog/discover', ({ query }) => {
  const genre = query.get('genre')
  const year = Number(query.get('year')) || undefined
  const decade = Number(query.get('decade')) || undefined
  const rating = Number(query.get('rating')) || undefined
  const studio = query.get('studio')
  const sort = query.get('sort') ?? 'popularity'
  const page = Math.max(1, Number(query.get('page')) || 1)

  const found = ofType(query.get('type'))
    .filter(
      title =>
        (!genre || title.genres.some(name => genreTag(name).id === genre))
        && (!year || title.year === year)
        && (!decade || (title.year >= decade && title.year < decade + 10))
        && (!rating || title.rating >= rating)
        && (!studio || (studio === 'company:9900002') === !!title.real),
    )
    .sort((a, b) =>
      sort === 'rating'
        ? b.rating - a.rating
        : sort === 'date'
          ? b.year - a.year
          : 0,
    )

  return {
    items: cardsOf(found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)),
    page,
    totalPages: Math.max(1, Math.ceil(found.length / PAGE_SIZE)),
    total: found.length,
  }
})

get<CatalogTrendingResponse>('/api/catalog/trending', () => ({
  items: cardsOf(TRENDING),
}))

get<CatalogBackdropsResponse>('/api/catalog/backdrops', () => ({
  items: TRENDING.map(title => ({
    id: title.id,
    title: title.title,
    year: title.year,
    backdrop: backdropFor(title),
  })),
}))

// Персоны: выдуманный каст и создатели из каталога, без фото. Один и тот же
// человек встречается в разных тайтлах под разными id — фильмография по имени

interface Credit {
  title: DemoTitle
  role: PersonCredit['detail']
  kind: 'acting' | 'creator' | 'directing'
}

const credits = new Map<string, Credit[]>()
const nameById = new Map<string, string>()
const firstId = new Map<string, string>()

for (const title of TITLES) {
  const extras = extrasOf(title)
  const add = (
    person: { id: string, name: string },
    credit: Omit<Credit, 'title'>,
  ) => {
    nameById.set(person.id, person.name)
    if (!firstId.has(person.name))
      firstId.set(person.name, person.id)
    credits.set(person.name, [
      ...(credits.get(person.name) ?? []),
      { title, ...credit },
    ])
  }

  for (const person of extras.cast)
    add(person, { role: person.role, kind: 'acting' })

  for (const person of extras.crew) {
    add(person, {
      role: undefined,
      kind: person.jobs.includes('creator') ? 'creator' : 'directing',
    })
  }
}

function biography(name: string, list: Credit[]) {
  const [first, second] = list.map(item => item.title.title)
  const works = second ? `${first} and ${second}` : first

  // Режиссёры открытых фильмов — настоящие люди: о них только то, что видно в титрах
  if (list.every(item => item.title.real))
    return `Director of the open movie ${works}, made by the Blender Foundation and released under a Creative Commons license.`

  return list[0]!.kind === 'acting'
    ? `${name} is a screen actor best known for ${works}.`
    : `${name} writes and directs character-driven stories. Credits include ${works}.`
}

get<PersonDetails>('/api/catalog/people/:id', ({ params }) => {
  const name = nameById.get(params.id!)
  const list = name ? credits.get(name) : undefined

  if (!name || !list)
    throw new DemoError(404, { message: 'Person not found' })

  const groups = (['acting', 'creator', 'directing'] as const)
    .map(role => ({
      role,
      items: list
        .filter(item => item.kind === role)
        .map(item => ({
          ...cardFor(item.title),
          detail: item.role,
          watched: statusOf(item.title) === 'watched',
        })),
    }))
    .filter(group => group.items.length > 0)
    .map(group => ({ ...group, total: group.items.length }))

  return {
    id: params.id!,
    name,
    knownFor: groups[0]!.role,
    biography: biography(name, list),
    credits: groups,
  }
})

get<CatalogSearchResponse>('/api/catalog/search', ({ query }) => {
  const text = (query.get('query') ?? '').trim().toLowerCase()
  const people: Person[] = text
    ? [...firstId]
        .filter(([name]) => name.toLowerCase().includes(text))
        .map(([name, id]) => ({ id, name }))
    : []

  return { items: text ? cardsOf(searchTitles(text)) : [], people }
})
