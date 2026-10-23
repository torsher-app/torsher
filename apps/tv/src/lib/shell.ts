import type { Platform } from './platform.ts'
import { panelUrl } from './panel.ts'

/**
 * Номер записи обёртки ТВ в истории: обёртка открывает витрину с `?shell=N`.
 * Без параметра витрину открыли не из обёртки, и возвращаться некуда.
 */
export function shellIndex(search: string): number | null {
  const value = new URLSearchParams(search).get('shell')
  if (value === null || !/^\d+$/.test(value))
    return null

  return Number(value)
}

/**
 * Шаг `history.go` до страницы обёртки. `currentPosition` — `position`
 * из `history.state` vue-router: это номер записи от начала истории окна.
 */
export function stepsToShell(shell: number, currentPosition: number) {
  const steps = shell - currentPosition
  return steps < 0 ? steps : null
}

/**
 * Вход владельца идёт через панель того же сервера, после входа она
 * возвращает на `next`.
 */
export function panelSignInUrl(
  location: Pick<Location, 'href' | 'pathname' | 'search' | 'hash'>,
  platform: Platform,
  base?: string,
) {
  const url = panelUrl('auth/login', location.href, base)
  // Панель увидит, что её открыли с ТВ: тёмная тема и крупные контролы
  if (platform === 'tv')
    url.searchParams.set('platform', 'tv')
  url.searchParams.set(
    'next',
    `${location.pathname}${location.search}${location.hash}`,
  )

  return url.href
}
