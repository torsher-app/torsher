import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { legacyApiGuard } from './build/legacyApiGuard.ts'

const API_URL = 'http://localhost:3001'

export default defineConfig({
  plugins: [vue(), legacyApiGuard()],
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
      '/api': {
        target: API_URL,
        rewrite: path => path.replace(/^\/api/, ''),
      },
      '/img': API_URL,
    },
  },
})
