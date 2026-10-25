import type { Theme } from 'vitepress'
// The site sets Onest itself: the default theme would also load Inter
import DefaultTheme from 'vitepress/theme-without-fonts'
import Draft from '../components/Draft.vue'
import Ui from '../components/Ui.vue'

import '@fontsource/onest/latin-400.css'
import '@fontsource/onest/latin-500.css'
import '@fontsource/onest/latin-600.css'
import '@fontsource/onest/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@torsher/tokens/tokens.css'
import './styles.css'
import './landing.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Draft', Draft)
    app.component('Ui', Ui)
  },
} satisfies Theme
