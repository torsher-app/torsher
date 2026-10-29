import type { DemoTitle } from '@torsher/demo/titles'
import { backdropUrl, posterUrl } from '@torsher/demo/art'
import bbbBackdrop from '@torsher/demo/media/bbb-backdrop.jpg?url'
import bbbPoster from '@torsher/demo/media/bbb-poster.jpg?inline'
import sintelBackdrop from '@torsher/demo/media/sintel-backdrop.jpg?url'
import sintelPoster from '@torsher/demo/media/sintel-poster.jpg?inline'
import tosBackdrop from '@torsher/demo/media/tos-backdrop.jpg?url'
import tosPoster from '@torsher/demo/media/tos-poster.jpg?inline'

/**
 * Кадры открытых фильмов. Постер — кадр под названием в той же SVG-обёртке,
 * что у остальных тайтлов, поэтому кадр постера встроен data:-адресом: SVG
 * в `<img>` внешние картинки не грузит. Фон обёртке не нужен — он файлом.
 */
const PHOTOS: Record<string, { poster: string, backdrop: string }> = {
  sintel: { poster: sintelPoster, backdrop: sintelBackdrop },
  bbb: { poster: bbbPoster, backdrop: bbbBackdrop },
  tos: { poster: tosPoster, backdrop: tosBackdrop },
}

// Рисунок — сотни килобайт SVG: строится один раз на тайтл
const posters = new Map<string, string>()
const backdrops = new Map<string, string>()

function photoOf(title: DemoTitle) {
  return title.real ? PHOTOS[title.real.slug] : undefined
}

export function posterFor(title: DemoTitle) {
  let url = posters.get(title.id)

  if (!url) {
    url = posterUrl(title, photoOf(title)?.poster)
    posters.set(title.id, url)
  }

  return url
}

export function backdropFor(title: DemoTitle) {
  let url = backdrops.get(title.id)

  if (!url) {
    url = photoOf(title)?.backdrop ?? backdropUrl(title)
    backdrops.set(title.id, url)
  }

  return url
}
