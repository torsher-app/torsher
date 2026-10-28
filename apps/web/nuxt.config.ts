import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'

// Демо для сайта: та же панель, но запросы `/api/*` обслуживают моки в
// браузере (`app/demo/`), а собирается она статикой под `/demo/` сайта
const isDemo = process.env.NUXT_PUBLIC_DEMO === '1'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // SPA: браузер ходит в API только через Nitro-прокси (server/api),
  // серверный рендеринг приложению не нужен
  ssr: false,

  modules: ['@nuxt/icon', '@nuxtjs/color-mode', 'shadcn-nuxt'],

  devtools: { enabled: true },

  // В продакшене панель — статика, которую сервер отдаёт на /panel/
  // рядом с витриной в корне; в разработке Nuxt работает на своём порту
  $production: {
    app: isDemo
      ? {
          baseURL: '/demo/',
          head: {
            meta: [{ name: 'robots', content: 'noindex' }],
            script: [
              {
                src: 'https://www.googletagmanager.com/gtag/js?id=G-HF50VGGL41',
                async: true,
              },
              {
                innerHTML:
                  'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag(\'js\',new Date());gtag(\'config\',\'G-HF50VGGL41\')',
              },
            ],
          },
        }
      : {
          baseURL: '/panel/',
        },
    runtimeConfig: {
      public: {
        // Витрины в демо нет: адрес — как у сервера в домашней сети, его
        // показывают «Подключите устройство», а ссылки перехватывает плагин
        tvUrl: isDemo ? 'http://192.168.1.10:8080/' : '/',
      },
    },
  },

  // Без стилей vue-sonner тосты рендерятся статично в конце страницы, за экраном
  css: ['~/assets/css/tailwind.css', 'vue-sonner/style.css'],

  runtimeConfig: {
    // Адрес backend для прокси. Переопределяется через NUXT_PROXY_URL
    proxyUrl: 'http://localhost:3001',
    public: {
      // Витрина для ссылок «Открыть на витрине». В разработке — свой dev-сервер,
      // когда витрину отдаёт сервер — его корень. NUXT_PUBLIC_TV_URL
      tvUrl: 'http://localhost:5173/',
    },
  },

  compatibilityDate: '2025-07-15',

  ...(isDemo && {
    // Свои каталоги: `pnpm -r build` собирает панель и демо параллельно
    buildDir: '.nuxt-demo',
    nitro: { output: { dir: '.output-demo' } },
    plugins: ['~/demo/plugin.ts'],
    // У сайта нет SPA-фолбэка для подпутей `/demo/*`: без hash прямая
    // ссылка и перезагрузка давали бы 404 сайта
    router: { options: { hashMode: true } },
  }),

  vite: {
    plugins: [tailwindcss()],
    define: { __DEMO__: JSON.stringify(isDemo) },
    build: {
      // Лицензии вшитых в бандл пакетов: образ кладёт файл в /usr/share/licenses.
      // В .output/public Nitro переносит только каталог _nuxt
      license: { fileName: '_nuxt/licenses.md' },
    },
  },

  colorMode: {
    classSuffix: '',
  },

  icon: {
    mode: 'svg',
  },

  shadcn: {
    prefix: '',
    componentDir: './app/components/ui',
  },
})
