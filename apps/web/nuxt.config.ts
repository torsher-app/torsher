import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'

// Демо для сайта: та же панель, но запросы `/api/*` обслуживают моки в
// браузере (`app/demo/`), а собирается она статикой под `/demo/` сайта
const isDemo = process.env.NUXT_PUBLIC_DEMO === '1'

const demoSeo = {
  url: 'https://torsher.app/demo/',
  title: 'Torsher demo: control panel in your browser',
  description:
    'Click through the Torsher control panel: overview, downloads, follows, sources, library and users. Made-up data, nothing to install.',
  image: 'https://torsher.app/og-image.png',
}

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
          // Своё описание для поиска и превью ссылок: демо — страница сайта
          head: {
            htmlAttrs: { lang: 'en' },
            title: demoSeo.title,
            link: [{ rel: 'canonical', href: demoSeo.url }],
            meta: [
              { name: 'description', content: demoSeo.description },
              { property: 'og:type', content: 'website' },
              { property: 'og:site_name', content: 'Torsher' },
              { property: 'og:title', content: demoSeo.title },
              { property: 'og:description', content: demoSeo.description },
              { property: 'og:url', content: demoSeo.url },
              { property: 'og:image', content: demoSeo.image },
              { name: 'twitter:card', content: 'summary_large_image' },
              { name: 'twitter:title', content: demoSeo.title },
              { name: 'twitter:description', content: demoSeo.description },
              { name: 'twitter:image', content: demoSeo.image },
            ],
            // Счётчик сайта грузится только на боевом домене: dev-сервер и
            // локальный предпросмотр в статистику не попадают
            script: [
              {
                innerHTML:
                  'if(location.hostname===\'torsher.app\'){var s=document.createElement(\'script\');s.async=true;s.src=\'https://www.googletagmanager.com/gtag/js?id=G-HF50VGGL41\';document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag(\'js\',new Date());gtag(\'config\',\'G-HF50VGGL41\')}',
              },
            ],
          },
        }
      : {
          baseURL: '/panel/',
        },
    runtimeConfig: {
      public: {
        // Демо витрины лежит на сайте рядом, в `demo/tv/`
        tvUrl: isDemo ? '/demo/tv/' : '/',
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
