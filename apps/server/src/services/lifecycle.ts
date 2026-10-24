import { logFor } from './logs/index.ts'

type RestartHandler = (reason: string) => void

// Без обработчика (тесты, команды) перезапуск только записывается в журнал
let handler: RestartHandler = (reason) => {
  logFor('server').warn(
    { reason },
    'Restart requested, but nothing restarts the server',
  )
}

/** Процесс сервера сам решает, как перезапуститься: `main.ts` штатно останавливается */
export function onRestartRequested(fn: RestartHandler) {
  handler = fn
}

export function requestRestart(reason: string) {
  handler(reason)
}
