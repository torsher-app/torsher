import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  // Относительные пути: витрину открывают и с сервера, и из обёртки webOS
  base: './',
  build: {
    // Минимальная платформа — webOS 5 (Chromium 68)
    target: 'chrome68',
  },
})
