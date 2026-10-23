import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { legacyApiGuard } from './build/legacyApiGuard.ts'

const API_URL = 'http://localhost:3001'
const PANEL_URL = 'http://localhost:3000'

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

export default defineConfig({
  plugins: [vue(), legacyApiGuard(), devPanelRedirect()],
  // Относительные пути: витрину открывают и с сервера, и из обёртки webOS
  base: './',
  build: {
    // Минимальная платформа — webOS 5 (Chromium 68)
    target: 'chrome68',
  },
  server: {
    // Тот же origin для API и картинок: cookie сессии, выданные панелью
    // на localhost, доходят до сервера и отсюда
    proxy: {
      '/api': API_URL,
    },
  },
})
