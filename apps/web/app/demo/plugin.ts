import { toast } from 'vue-sonner'
import { trackScreen } from '@torsher/demo/analytics'
import { handle, UNAVAILABLE } from '@torsher/demo/router'
import './handlers'

/**
 * Демо панели: сервера нет, запросы `/api/*` обслуживают моки в браузере.
 * Подменяется только `window.fetch`, поэтому ядро клиента (refresh, повтор,
 * режимы ошибок) работает так же, как с настоящим сервером.
 */
export default defineNuxtPlugin({
  name: 'demo',
  enforce: 'pre',
  setup(nuxtApp) {
    const t = (key: string) =>
      nuxtApp.vueApp.config.globalProperties.$t(key) as string

    const realFetch = window.fetch.bind(window)

    window.fetch = (input, init = {}) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      )

      if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
        return realFetch(input, init)

      // Режим ядро берёт синхронно перед `fetch`, поэтому здесь он тот же
      const mode = currentErrorMode()

      // Загрузку файла копии панель шлёт голым `fetch`, мимо ядра и его тостов
      const isRawUpload = init.body instanceof Blob

      return handle(url, init, t('panel.demo.unavailable')).then((response) => {
        // Тихий запрос и загрузка показывают свою ошибку («не удалось…»):
        // говорим «недоступно в демо» сами и позже неё, чтобы наш тост
        // лёг в стопке сверху
        if (
          response.status === UNAVAILABLE
          && (mode !== 'toast' || isRawUpload)
        ) {
          setTimeout(() => toast.info(t('panel.demo.unavailable')), 100)
        }

        return response
      })
    }

    // Скачивание файлов с `/api/*` идёт ссылкой мимо клиента
    document.addEventListener(
      'click',
      (event) => {
        const link = (event.target as Element | null)?.closest?.('a[href]')
        if (!(link instanceof HTMLAnchorElement))
          return

        const url = new URL(link.href, location.href)

        if (
          url.origin === location.origin
          && url.pathname.startsWith('/api/')
        ) {
          event.preventDefault()
          toast.info(t('panel.demo.unavailable'))
        }
      },
      { capture: true },
    )

    // Первый переход роутер делает до монтирования, поэтому текущий экран
    // отмечаем отдельно
    nuxtApp.hook('app:mounted', () => {
      const router = useRouter()
      const screenOf = (route: typeof router.currentRoute.value) =>
        route.matched.at(-1)?.path ?? route.path

      trackScreen('panel', screenOf(router.currentRoute.value))
      router.afterEach((to, from, failure) => {
        if (!failure && to.path !== from.path)
          trackScreen('panel', screenOf(to))
      })
    })
  },
})
