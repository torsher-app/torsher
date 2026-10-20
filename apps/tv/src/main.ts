import '@torsher/tokens/tokens.css'
import './styles/fonts.css'
import './styles/app.css'
import { createApp } from 'vue'
import App from './App.vue'
import { createFocus } from './focus/index.ts'
import { i18n } from './i18n.ts'
import { resolvePlatform } from './lib/platform.ts'
import { router } from './router.ts'

document.documentElement.setAttribute(
  'data-platform',
  resolvePlatform(window.location.search),
)

// Back на первом экране никуда не уходит: в браузере router.back() увёл бы
// со страницы, а выход из приложения на ТВ спросит подтверждение (позже)
function back() {
  if (router.options.history.state.back)
    router.back()
}

createApp(App)
  .use(router)
  .use(i18n)
  .use(createFocus({ onBack: back }))
  .mount('#app')
