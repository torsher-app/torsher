import type { LocationQueryValue } from 'vue-router'
import { createRouter, createWebHashHistory } from 'vue-router'
import AboutPage from './pages/AboutPage.vue'
import FilesPage from './pages/FilesPage.vue'
import HomePage from './pages/HomePage.vue'
import PlayerPage from './pages/PlayerPage.vue'
import SearchPage from './pages/SearchPage.vue'
import SourcesPage from './pages/SourcesPage.vue'
import TitlePage from './pages/TitlePage.vue'

function queryOf(value: LocationQueryValue | LocationQueryValue[] | undefined) {
  return typeof value === 'string' ? value : undefined
}

// Hash-история: витрине не нужен fallback на index.html ни на сервере, ни в обёртке ТВ
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomePage, props: { mode: 'all' } },
    { path: '/movies', component: HomePage, props: { mode: 'movies' } },
    { path: '/series', component: HomePage, props: { mode: 'series' } },
    { path: '/search', component: SearchPage },
    { path: '/title/:id', component: TitlePage, props: true },
    // «Смотреть» на карточке → все раздачи тайтла → файлы выбранной → плеер
    { path: '/title/:id/sources', component: SourcesPage, props: true },
    {
      path: '/title/:id/files/:torrentId',
      component: FilesPage,
      // Из истории «Источников» — серия, на которую встаёт фокус
      props: route => ({
        id: route.params.id,
        torrentId: route.params.torrentId,
        season: queryOf(route.query.season),
        episode: queryOf(route.query.episode),
      }),
    },
    { path: '/about', component: AboutPage },
    {
      path: '/play/:torrentId/:fileIndex',
      component: PlayerPage,
      // Из карточки тайтла плеер получает тайтл и серию в query
      props: route => ({
        torrentId: route.params.torrentId,
        fileIndex: route.params.fileIndex,
        titleId: queryOf(route.query.title),
        season: queryOf(route.query.season),
        episode: queryOf(route.query.episode),
      }),
    },
  ],
})
