import '@torsher/tokens/tokens.css'
import './styles/app.css'
import { createApp } from 'vue'
import App from './App.vue'
import { createFocus } from './focus/index.ts'
import { i18n } from './i18n.ts'
import { router } from './router.ts'

createApp(App)
  .use(router)
  .use(i18n)
  .use(createFocus({ onBack: () => router.back() }))
  .mount('#app')
