import type { Plugin } from 'vite'
import { legacyApiGuard } from '@torsher/tv/build/legacyApiGuard.ts'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

const APP_ID = 'app.torsher.webos'

/** Манифест приложения webOS; версия — из package.json пакета */
const appInfo = {
  id: APP_ID,
  version: pkg.version,
  vendor: 'Torsher',
  type: 'web',
  main: 'index.html',
  title: 'Torsher',
  appDescription: 'Torsher media server showcase',
  icon: 'icon-80.png',
  largeIcon: 'icon-130.png',
  bgColor: '#0b0d12',
  iconColor: '#0b0d12',
  resolution: '1920x1080',
  // Back приходит в страницу клавишей 461, а не уходит в history.back()
  disableBackHistoryAPI: true,
  // Luna API обёртка не вызывает; поле пустым требуют новые версии webOS
  requiredACG: [],
}

/**
 * Страница обёртки открывается с file://: модульный скрипт и `crossorigin`
 * Chromium грузит в режиме CORS, а у file:// origin `null`. Поэтому бандл —
 * один IIFE обычным скриптом, без modulepreload.
 */
function webosApp(): Plugin {
  return {
    name: 'torsher:webos-app',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: html =>
        html
          .replace(/<script type="module" crossorigin/g, '<script defer')
          .replace(/ crossorigin(?=[\s>])/g, ''),
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'appinfo.json',
        source: `${JSON.stringify(appInfo, null, 2)}\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [webosApp(), legacyApiGuard()],
  base: './',
  build: {
    // Минимальная платформа — та же, что у витрины: webOS 5 (Chromium 68)
    target: 'chrome68',
    modulePreload: false,
    rolldownOptions: {
      output: { format: 'iife' },
    },
  },
})
