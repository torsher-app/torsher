import '@torsher/tokens/tokens.css'
import './styles/fonts.css'
import './styles/app.css'
import { createApp } from 'vue'
import App from './App.vue'
import { createFocus } from './focus/index.ts'
import { i18n } from './i18n.ts'
import { platform } from './platform/index.ts'
import { exitApp } from './platform/webos.ts'
import { router } from './router.ts'

document.documentElement.setAttribute('data-platform', platform)

// Back на первом экране: на ТВ — выход из приложения (подтверждение
// показывает система), в браузере — ничего, router.back() увёл бы со страницы
function back() {
  if (router.options.history.state.back)
    router.back()
  else if (platform === 'tv')
    exitApp()
}

createApp(App)
  .use(router)
  .use(i18n)
  .use(createFocus({ onBack: back }))
  .mount('#app')
