import { createApiClient, getErrorStatus } from '@torsher/api-client'
import { toLoadError } from './lib/loadError.ts'

let sessionExpired = () => {}
let profileRequired = () => {}

/**
 * Сессия кончилась посреди работы: устройство отключили в панели или у
 * владельца не обновился вход. Обработчик ставит `main.ts`, чтобы клиент API
 * не зависел от роутера.
 */
export function onSessionExpired(handler: () => void) {
  sessionExpired = handler
}

/**
 * Сервер требует выбрать профиль: у профиля по умолчанию появился PIN или
 * выбранный на устройстве профиль удалили. Обработчик ставит `main.ts`.
 */
export function onProfileRequired(handler: () => void) {
  profileRequired = handler
}

// Ошибки показывает сам экран: тостов и страницы ошибки у витрины нет.
// Режим `toast` нужен только затем, чтобы клиент отдал сообщение ошибки
// в `onError`: так витрина узнаёт ответ «выберите профиль»
export const api = createApiClient({
  getErrorMode: () => 'toast',
  onSessionExpired: () => sessionExpired(),
  onError: (message, status) => {
    if (status === 403 && message === 'profile_required')
      profileRequired()
  },
  onFatal: () => {},
})

export function loadErrorOf(err: unknown) {
  return toLoadError(getErrorStatus(err))
}
