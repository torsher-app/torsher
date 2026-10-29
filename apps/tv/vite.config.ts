import type { Plugin } from 'vite'
import process from 'node:process'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { legacyApiGuard } from './build/legacyApiGuard.ts'

// Свои адреса задаёт стенд ветки (`pnpm dev:stand`): он поднимает всё на других портах
const API_URL = process.env.TORSHER_API_URL || 'http://localhost:3001'
const PANEL_URL = process.env.TORSHER_PANEL_URL || 'http://localhost:3000'

/**
 * Витрина ведёт в панель по `panel/` рядом с собой, как на сервере. В
 * разработке у панели свой dev-сервер, а здесь `/panel/...` отдал бы саму
 * витрину. Cookie на `localhost` общие для всех портов, и вход в панели
 * авторизует витрину.
 */
function devPanelRedirect(): Plugin {
  return {
    name: 'torsher:dev-panel-redirect',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/panel', (req, res) => {
        res.statusCode = 302
        res.setHeader('Location', `${PANEL_URL}${req.url ?? '/'}`)
        res.end()
      })
    },
  }
}

/**
 * Демо — страница сайта `torsher.app`: своё описание для поиска и превью
 * ссылок, статистика сайта, как у демо панели. Счётчик грузится только на
 * боевом домене, чтобы dev-сервер и локальный предпросмотр не попадали в
 * статистику
 */
function demoHead(): Plugin {
  const id = 'G-HF50VGGL41'
  const url = 'https://torsher.app/demo/tv/'
  const title = 'Torsher demo: TV showcase in your browser'
  const description
    = 'Browse the Torsher TV showcase with a mouse or the arrow keys: home rows, titles, seasons, search and the player. Made-up catalog, nothing to install.'
  const image = 'https://torsher.app/og-image.png'
  const meta = (attrs: Record<string, string>) => ({
    tag: 'meta',
    attrs,
    injectTo: 'head' as const,
  })

  return {
    name: 'torsher:demo-head',
    transformIndexHtml: html => ({
      html: html
        .replace('<html lang="ru">', '<html lang="en">')
        .replace('<title>Torsher</title>', `<title>${title}</title>`),
      tags: [
        meta({ name: 'description', content: description }),
        {
          tag: 'link',
          attrs: { rel: 'canonical', href: url },
          injectTo: 'head',
        },
        meta({ property: 'og:type', content: 'website' }),
        meta({ property: 'og:site_name', content: 'Torsher' }),
        meta({ property: 'og:title', content: title }),
        meta({ property: 'og:description', content: description }),
        meta({ property: 'og:url', content: url }),
        meta({ property: 'og:image', content: image }),
        meta({ name: 'twitter:card', content: 'summary_large_image' }),
        meta({ name: 'twitter:title', content: title }),
        meta({ name: 'twitter:description', content: description }),
        meta({ name: 'twitter:image', content: image }),
        {
          tag: 'script',
          children: `if(location.hostname==='torsher.app'){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${id}';document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${id}')}`,
          injectTo: 'head',
        },
      ],
    }),
  }
}

export default defineConfig(({ mode }) => {
  // Демо для сайта: та же витрина, но `/api/*` отвечают моки в браузере
  // (`src/demo/`). Его открывают на компьютере, а не на ТВ, поэтому проверка
  // API старых браузеров — только для обычной сборки
  const isDemo = mode === 'demo'

  return {
    plugins: [
      vue(),
      ...(isDemo ? [demoHead()] : [legacyApiGuard()]),
      devPanelRedirect(),
    ],
    define: { __DEMO__: JSON.stringify(isDemo) },
    // Относительные пути: витрину открывают и с сервера, и из обёртки webOS
    base: './',
    build: {
      // Минимальная платформа — webOS 5 (Chromium 68)
      target: 'chrome68',
      // Лицензии вшитых в бандл пакетов: образ кладёт файл в /usr/share/licenses
      license: true,
    },
    server: {
      // Тот же origin для API и картинок: cookie сессии, выданные панелью
      // на localhost, доходят до сервера и отсюда
      proxy: {
        '/api': API_URL,
      },
    },
  }
})
