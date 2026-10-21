import type { Component } from 'vue'
import { RadarIcon } from '@lucide/vue'

export interface NavItem {
  to: string
  /** Ключ строки в `panel.nav` */
  label: 'sources'
  icon: Component
}

// Новый раздел панели добавляется сюда вместе со своей страницей.
// «Настройки» живут внизу сайдбара, их подразделы — в `settingsItems`
export const navItems: NavItem[] = [
  { to: '/sources', label: 'sources', icon: RadarIcon },
]

export interface SettingsItem {
  to: string
  /** Ключ строки в `panel.settings.nav` */
  label: 'account' | 'about'
}

export const settingsItems: SettingsItem[] = [
  { to: '/settings/account', label: 'account' },
  { to: '/settings/about', label: 'about' },
]
