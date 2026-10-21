import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // SPA: браузер ходит в API только через Nitro-прокси (server/api),
  // серверный рендеринг приложению не нужен
  ssr: false,

  modules: ['@nuxt/icon', '@nuxtjs/color-mode', 'shadcn-nuxt'],

  devtools: { enabled: true },

  // Без стилей vue-sonner тосты рендерятся статично в конце страницы, за экраном
  css: ['~/assets/css/tailwind.css', 'vue-sonner/style.css'],

  runtimeConfig: {
    // Адрес backend для прокси. Переопределяется через NUXT_PROXY_URL
    proxyUrl: 'http://localhost:3001',
  },

  compatibilityDate: '2025-07-15',

  vite: {
    plugins: [tailwindcss()],
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
