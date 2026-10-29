import { trackScreen } from '@torsher/demo/analytics'
import { handle, UNAVAILABLE } from '@torsher/demo/router'
import { createApp } from 'vue'
import { i18n } from '../i18n.ts'
import { router } from '../router.ts'
import DemoBar from './DemoBar.vue'
import NarrowGate from './NarrowGate.vue'
import { showNotice } from './notice.ts'
import './handlers/index.ts'

const NARROW_WIDTH = 768
const NARROW_KEY = 'torsher.demo.narrowSeen'

function t(key: string) {
  return i18n.global.t(key)
}

/**
 * Демо витрины: сервера нет, запросы `/api/*` обслуживают моки в браузере.
 * Подменяется только `window.fetch`, поэтому ядро клиента работает так же,
 * как с настоящим сервером. Витрина ошибки запросов показывает своими
 * экранами, а «недоступно в демо» говорит полоса демо.
 */
function patchFetch() {
  const realFetch = window.fetch.bind(window)

  window.fetch = (input, init = {}) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      location.href,
    )

    if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
      return realFetch(input, init)

    return handle(url, init, t('demo.unavailable')).then((response) => {
      if (response.status === UNAVAILABLE)
        showNotice(t('demo.unavailable'))

      return response
    })
  }
}

function isNarrowFirstVisit() {
  if (window.innerWidth >= NARROW_WIDTH)
    return false

  try {
    return sessionStorage.getItem(NARROW_KEY) === null
  }
  catch {
    return true
  }
}

function mountBar() {
  const host = document.createElement('div')

  document.body.append(host)
  createApp(DemoBar).use(i18n).mount(host)
}

/**
 * Ставит моки и полосу демо, затем запускает витрину. На телефоне сначала
 * предупреждает, что витрина свёрстана под большой экран
 */
export function installDemo(start: () => void) {
  patchFetch()
  // У стартового маршрута путь тоже `/`, его узнаём по пустому `matched`
  router.afterEach((to, from, failure) => {
    if (!failure && (to.path !== from.path || !from.matched.length))
      trackScreen('tv', to.matched.at(-1)?.path ?? to.path)
  })

  if (!isNarrowFirstVisit()) {
    mountBar()
    start()
    return
  }

  const host = document.createElement('div')

  document.body.append(host)
  const gate = createApp(NarrowGate, {
    onOpen() {
      try {
        sessionStorage.setItem(NARROW_KEY, '1')
      }
      catch {}

      gate.unmount()
      host.remove()
      mountBar()
      start()
    },
  }).use(i18n)

  gate.mount(host)
}
