import '@torsher/tokens/tokens.css'
import './styles/fonts.css'
import './styles/app.css'
import { createApp } from 'vue'
import { onProfileRequired, onSessionExpired } from './api.ts'
import App from './App.vue'
import { createFocus } from './focus/index.ts'
import { i18n } from './i18n.ts'
import { connectAndroidShell } from './platform/android.ts'
import { platform } from './platform/index.ts'
import { exitApp } from './platform/shell.ts'
import { goBack } from './lib/navigation.ts'
import { gateTarget } from './lib/session.ts'
import { misaligned, railAxisOffsets } from './lib/railAxis.ts'
import { router } from './router.ts'
import { expireSession, requireProfile, session } from './session.ts'

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

// Профиль на устройстве сбросили (удалили его или поставили PIN на профиль
// по умолчанию): к выбору профиля, а после него — обратно на этот экран
onProfileRequired(() => {
  if (!requireProfile())
    return

  const target = gateTarget(session.status, router.currentRoute.value)

  if (target)
    void router.replace(target)
})

// Замер оси рейла из консоли разработки: `railAxis()` — сдвиги иконок от
// центров кругов в пикселях макета, `.bad` пуст — рейл ровный
if (import.meta.env.DEV) {
  Object.assign(window, {
    railAxis() {
      const offsets = railAxisOffsets(document, window.innerWidth / 1920)

      return { offsets, bad: misaligned(offsets) }
    },
  })
}

connectAndroidShell()

function start() {
  createApp(App)
    .use(router)
    .use(i18n)
    .use(createFocus({ onBack: back, nativeWheel: platform === 'web' }))
    .mount('#app')
}

// Демо подменяет `fetch` до первого запроса витрины; в обычной сборке ветка
// и её чанк вырезаются
if (__DEMO__)
  void import('./demo/index.ts').then(({ installDemo }) => installDemo(start))
else start()
