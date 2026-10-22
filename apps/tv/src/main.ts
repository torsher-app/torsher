import '@torsher/tokens/tokens.css'
import './styles/fonts.css'
import './styles/app.css'
import { createApp } from 'vue'
import { onSessionExpired } from './api.ts'
import App from './App.vue'
import { createFocus } from './focus/index.ts'
import { i18n } from './i18n.ts'
import { platform } from './platform/index.ts'
import { exitApp } from './platform/webos.ts'
import { goBack } from './lib/navigation.ts'
import { router } from './router.ts'
import { expireSession, session } from './session.ts'

document.documentElement.setAttribute('data-platform', platform)

// Back на первом экране: на ТВ — выход из приложения (подтверждение
// показывает система), в браузере — ничего, router.back() увёл бы со страницы
function back() {
  goBack(router, platform === 'tv' ? exitApp : undefined)
}

// Устройство отключили в панели посреди просмотра: обратно к экрану кода.
// До выбора профиля 401 разбирает сам запрос профилей
onSessionExpired(() => {
  if (session.status !== 'ready')
    return

  expireSession()
  void router.replace('/connect')
})

createApp(App)
  .use(router)
  .use(i18n)
  .use(createFocus({ onBack: back, nativeWheel: platform === 'web' }))
  .mount('#app')
