import type { Component } from 'vue'
import {
  ArrowDownToLineIcon,
  BookmarkIcon,
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
    | 'overview'
    | 'torrents'
    | 'library'
    | 'sources'
    | 'collections'
    | 'people'
    | 'logs'
  icon: Component
}

// Новый раздел панели добавляется сюда вместе со своей страницей.
// «Настройки» живут внизу сайдбара, их подразделы — в `settingsItems`
export const navItems: NavItem[] = [
  { to: '/', label: 'overview', icon: LayoutGridIcon },
  { to: '/downloads', label: 'torrents', icon: ArrowDownToLineIcon },
  // Иконки как на витрине: полка — библиотека; подборки там живут в «Моё» с закладкой
  { to: '/library', label: 'library', icon: LibraryIcon },
  { to: '/sources', label: 'sources', icon: RadarIcon },
  { to: '/collections', label: 'collections', icon: BookmarkIcon },
  { to: '/people', label: 'people', icon: MonitorSmartphoneIcon },
  { to: '/logs', label: 'logs', icon: ScrollTextIcon },
]

export interface SettingsItem {
  to: string
  /** Ключ строки в `panel.settings.nav` */
  label:
    | 'storage'
    | 'network'
    | 'metadata'
    | 'playback'
    | 'notifications'
    | 'account'
    | 'about'
}

export const settingsItems: SettingsItem[] = [
  { to: '/settings/storage', label: 'storage' },
  { to: '/settings/network', label: 'network' },
  { to: '/settings/metadata', label: 'metadata' },
  { to: '/settings/playback', label: 'playback' },
  { to: '/settings/notifications', label: 'notifications' },
  { to: '/settings/account', label: 'account' },
  { to: '/settings/about', label: 'about' },
]
