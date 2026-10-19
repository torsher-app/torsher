import { createRouter, createWebHashHistory } from 'vue-router'
import SearchPage from './pages/SearchPage.vue'
import TitlePage from './pages/TitlePage.vue'

// Hash-история: витрине не нужен fallback на index.html ни на сервере, ни в обёртке ТВ
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/search' },
    { path: '/search', component: SearchPage },
    { path: '/title/:id', component: TitlePage, props: true },
  ],
})
