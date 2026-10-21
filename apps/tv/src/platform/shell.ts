import type { RouterHistory } from 'vue-router'
import { panelSignInUrl, shellIndex, stepsToShell } from '../lib/shell.ts'

const shell = shellIndex(window.location.search)

/** Витрину открыла обёртка ТВ, и к ней можно вернуться */
export const canReturnToShell = shell !== null

/**
 * «Сменить сервер»: назад по истории до страницы обёртки, она покажет экран
 * адреса. Напрямую на её file:// страница с http перейти не может.
 */
export function returnToShell(history: RouterHistory) {
  const position = history.state.position
  const steps
    = shell !== null && typeof position === 'number'
      ? stepsToShell(shell, position)
      : null

  if (steps !== null)
    window.history.go(steps)
}

export function signInOnTv() {
  window.location.assign(panelSignInUrl(window.location))
}
