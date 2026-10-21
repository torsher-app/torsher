import type { Component } from 'vue'
import { InfoIcon, RadarIcon } from '@lucide/vue'

export interface NavItem {
  to: string
  /** Ключ строки в `panel.nav` */
  label: 'sources' | 'about'
  icon: Component
}

// Новый раздел панели добавляется сюда вместе со своей страницей
export const navItems: NavItem[] = [
  { to: '/sources', label: 'sources', icon: RadarIcon },
  { to: '/about', label: 'about', icon: InfoIcon },
]
