import type { RouterHistory } from 'vue-router'
import { panelSignInUrl, shellIndex, stepsToShell } from '../lib/shell.ts'
import {
  changeAndroidServer,
  exitAndroidApp,
  isAndroidShell,
} from './android.ts'
import { platform } from './index.ts'
import { exitApp as exitWebosApp } from './webos.ts'

const shell = shellIndex(window.location.search)

/** Витрину открыла обёртка ТВ, и к ней можно вернуться */
export const canReturnToShell = shell !== null || isAndroidShell

/**
 * «Сменить сервер»: экран адреса обёртки. На Android его показывает
 * оболочка по команде моста; на webOS — назад по истории до страницы
 * обёртки: напрямую на её file:// страница с http перейти не может.
 */
export function returnToShell(history: RouterHistory) {
  if (isAndroidShell) {
    changeAndroidServer()
    return
  }

  const position = history.state.position
  const steps
    = shell !== null && typeof position === 'number'
      ? stepsToShell(shell, position)
      : null

  if (steps !== null)
    window.history.go(steps)
}

/**
 * Выход по Back с первого экрана: на Android — командой оболочке, на webOS —
 * системным выходом. В браузере ничего не делает.
 */
export function exitApp() {
  if (isAndroidShell)
    exitAndroidApp()
  else exitWebosApp()
}

/** «Войти как владелец»: сессия владельца открывает витрину без кода */
export function signInAsOwner() {
  window.location.assign(panelSignInUrl(window.location, platform))
}
