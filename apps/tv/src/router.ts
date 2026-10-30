import type { LocationQueryValue, RouteLocationNormalized } from 'vue-router'
import { ref } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { gateTarget } from './lib/session.ts'
import AboutPage from './pages/AboutPage.vue'
import CatalogPage from './pages/CatalogPage.vue'
import ConnectPage from './pages/ConnectPage.vue'
import FilesPage from './pages/FilesPage.vue'
import { createScreenKeys } from './lib/screenKeys.ts'
import HomePage from './pages/HomePage.vue'
import HomeVideoPage from './pages/HomeVideoPage.vue'
import PersonPage from './pages/PersonPage.vue'
import PlayerPage from './pages/PlayerPage.vue'
import ProfilesPage from './pages/ProfilesPage.vue'
import MinePage from './pages/MinePage.vue'
import ResolvePage from './pages/ResolvePage.vue'
import SearchPage from './pages/SearchPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import SourcesPage from './pages/SourcesPage.vue'
import TitlePage from './pages/TitlePage.vue'
import { resolveSession, session } from './session.ts'

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
    { path: '/library', component: HomePage, props: { mode: 'library' } },
    { path: '/home-video', component: HomeVideoPage },
    // Альбом домашнего видео: та же страница, видео одной папки
    {
      path: '/home-video/album',
      component: HomeVideoPage,
      props: route => ({
        libraryId: queryOf(route.query.library),
        album: queryOf(route.query.album) ?? '',
      }),
    },
    // Тайтл для раздачи без тайтла: тот же поиск, OK по постеру — выбор
    {
      path: '/library/pick',
      component: SearchPage,
      props: route => ({
        pick: queryOf(route.query.torrent),
        initialQuery: queryOf(route.query.q),
        pickName: queryOf(route.query.name),
      }),
    },
    { path: '/search', component: SearchPage },
    { path: '/mine', component: MinePage },
    // Фильтр каталога — в query
    { path: '/catalog', component: CatalogPage },
    // Карточка и персона — стек экранов: по цепочке «актёр → фильм → режиссёр»
    // Back возвращает каждый экран с его фокусом (App.vue)
    {
      path: '/title/:id',
      component: TitlePage,
      props: true,
      meta: { stack: true },
    },
    {
      path: '/person/:id',
      component: PersonPage,
      props: true,
      meta: { stack: true },
    },
    // «Смотреть» на карточке → все раздачи тайтла → файлы выбранной → плеер.
    // «Источники» — тоже в стеке: Back из «Файлов» возвращает тот же список,
    // а новый вход с карточки открывает его с начала
    {
      path: '/title/:id/sources',
      component: SourcesPage,
      meta: { stack: true },
      // «Скачать фильм / сезон» — тот же выбор раздачи, дальше «Файлы» с отметками
      props: route => ({
        id: route.params.id,
        download: route.query.download === '1',
        season: queryOf(route.query.season),
      }),
    },
    {
      path: '/title/:id/files/:torrentId',
      component: FilesPage,
      // Из истории «Источников» — серия, на которую встаёт фокус
      props: route => ({
        id: route.params.id,
        torrentId: route.params.torrentId,
        season: queryOf(route.query.season),
        episode: queryOf(route.query.episode),
        download: route.query.download === '1',
      }),
    },
    { path: '/settings', component: SettingsPage },
    // «Продолжить», следующая серия без известного файла и другая раздача из
    // плеера: поиск файла серии → плеер
    {
      path: '/title/:id/play',
      component: ResolvePage,
      props: route => ({
        id: route.params.id,
        season: queryOf(route.query.season),
        episode: queryOf(route.query.episode),
        torrent: queryOf(route.query.torrent),
        candidate: queryOf(route.query.candidate),
        voice: queryOf(route.query.voice),
      }),
    },
    { path: '/about', component: AboutPage },
    // Подключение по коду и «Кто смотрит?»: сюда ведёт гейт ниже
    { path: '/connect', component: ConnectPage },
    { path: '/profiles', component: ProfilesPage },
    // Файл библиотеки играется с диска сервера, без раздачи
    {
      path: '/play/library/:mediaFileId',
      component: PlayerPage,
      props: route => ({
        mediaFileId: route.params.mediaFileId,
        titleId: queryOf(route.query.title),
        season: queryOf(route.query.season),
        episode: queryOf(route.query.episode),
      }),
    },
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
        voice: queryOf(route.query.voice),
      }),
    },
  ],
})

// Без подключения и выбранного профиля витрина ведёт на экран кода или выбора.
// На первом переходе ждёт ответа сервера: экран не мигает главной
router.beforeEach(async (to) => {
  if (session.status === 'unknown')
    await resolveSession()

  return gateTarget(session.status, to) ?? true
})

/** Экран живёт в стеке KeepAlive по записи истории, а не по пути */
export function isStacked(route: RouteLocationNormalized) {
  return route.meta.stack === true
}

const keyOf = createScreenKeys()
let popped = false

/** Ключ экрана стека для текущей записи истории */
export const screenKey = ref('')

// Слушатели истории vue-router вызываются только на popstate: шаг по истории
router.options.history.listen(() => {
  popped = true
})

// afterEach идёт до отрисовки нового маршрута: ключ готов к рендеру RouterView
router.afterEach((to, _from, failure) => {
  if (!failure) {
    const position = router.options.history.state.position

    screenKey.value = keyOf(
      typeof position === 'number' ? position : 0,
      to.path,
      popped,
    )
  }

  popped = false
})
