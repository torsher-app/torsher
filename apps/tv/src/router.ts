import { createRouter, createWebHashHistory } from 'vue-router'
import AboutPage from './pages/AboutPage.vue'
import HomePage from './pages/HomePage.vue'
import SearchPage from './pages/SearchPage.vue'
import TitlePage from './pages/TitlePage.vue'

// Hash-история: витрине не нужен fallback на index.html ни на сервере, ни в обёртке ТВ
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomePage, props: { mode: 'all' } },
    { path: '/movies', component: HomePage, props: { mode: 'movies' } },
    { path: '/series', component: HomePage, props: { mode: 'series' } },
    { path: '/search', component: SearchPage },
    { path: '/title/:id', component: TitlePage, props: true },
    { path: '/about', component: AboutPage },
  ],
})
