import { toast } from 'vue-sonner'
import { handle, UNAVAILABLE } from './router'
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

    // Ссылки мимо клиента: скачивание файлов с `/api/*` и витрина, которой
    // в демо нет. Сайт и документация открываются как обычно
    const tvBase = new URL(useRuntimeConfig().public.tvUrl, location.href).href

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
        else if (url.href.startsWith(tvBase)) {
          event.preventDefault()
          toast.info(t('panel.demo.tvUnavailable'), {
            action: {
              label: 'torsher.app',
              onClick: () => window.open('/', '_blank', 'noopener'),
            },
          })
        }
      },
      { capture: true },
    )
  },
})
