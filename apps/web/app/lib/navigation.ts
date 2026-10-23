import type { Component } from 'vue'
import {
  ArrowDownToLineIcon,
  LayoutGridIcon,
  LibraryIcon,
  MonitorSmartphoneIcon,
  RadarIcon,
  ScrollTextIcon,
} from '@lucide/vue'

export interface NavItem {
  to: string
  /** Ключ строки в `panel.nav` */
  label:
    'overview' | 'torrents' | 'sources' | 'collections' | 'people' | 'logs'
  icon: Component
}

// Новый раздел панели добавляется сюда вместе со своей страницей.
// «Настройки» живут внизу сайдбара, их подразделы — в `settingsItems`
export const navItems: NavItem[] = [
  { to: '/', label: 'overview', icon: LayoutGridIcon },
  { to: '/downloads', label: 'torrents', icon: ArrowDownToLineIcon },
  { to: '/sources', label: 'sources', icon: RadarIcon },
  { to: '/collections', label: 'collections', icon: LibraryIcon },
  { to: '/people', label: 'people', icon: MonitorSmartphoneIcon },
  { to: '/logs', label: 'logs', icon: ScrollTextIcon },
]

export interface SettingsItem {
  to: string
  /** Ключ строки в `panel.settings.nav` */
  label: 'storage' | 'network' | 'metadata' | 'playback' | 'account' | 'about'
}

export const settingsItems: SettingsItem[] = [
  { to: '/settings/storage', label: 'storage' },
  { to: '/settings/network', label: 'network' },
  { to: '/settings/metadata', label: 'metadata' },
  { to: '/settings/playback', label: 'playback' },
  { to: '/settings/account', label: 'account' },
  { to: '/settings/about', label: 'about' },
]
