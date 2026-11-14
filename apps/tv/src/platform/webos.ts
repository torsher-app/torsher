import type { ScreensaverDebugEvent } from '../inputDebug.ts'

interface PalmSystem {
  platformBack?: () => void
}

/** Мост к Luna: один экземпляр — один вызов, следующий `call` отменяет прошлый */
interface ServiceBridge {
  onservicecallback?: (message: string) => void
  call: (uri: string, payload: string) => void
  cancel: () => void
}

type ServiceBridgeConstructor = new () => ServiceBridge

declare global {
  interface Window {
    PalmSystem?: PalmSystem
    PalmServiceBridge?: ServiceBridgeConstructor
    WebOSServiceBridge?: ServiceBridgeConstructor
  }
}

const TV_POWER = 'luna://com.webos.service.tvpower/power'
// По имени клиента tvpower сводит свой запрос с нашим ответом
const SCREENSAVER_CLIENT = 'torsher'

function serviceBridge(): ServiceBridge | undefined {
  const Bridge = window.WebOSServiceBridge ?? window.PalmServiceBridge

  try {
    return Bridge ? new Bridge() : undefined
  }
  catch {
    return undefined
  }
}

/** Best-effort veto только на время нашей заставки. Отправка RPC не означает успех. */
export function holdSystemScreensaver(
  report?: (event: Extract<ScreensaverDebugEvent, { kind: 'luna' }>) => void,
): () => void {
  function emit(
    status: Extract<ScreensaverDebugEvent, { kind: 'luna' }>['status'],
    code?: number,
  ) {
    report?.({ kind: 'luna', status, ...(code === undefined ? {} : { code }) })
  }
  const subscription = serviceBridge()
  if (!subscription) {
    emit('unavailable')
    return () => {}
  }

  let held = true
  let released = false
  let responder: ServiceBridge | undefined

  function parse(
    message: string,
  ):
    | { timestamp?: number | string, returnValue?: boolean, errorCode?: number }
    | undefined {
    try {
      const value: unknown = JSON.parse(message)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as {
          timestamp?: number | string
          returnValue?: boolean
          errorCode?: number
        }
      }
    }
    catch {
      /* Повреждённое сообщение не должно ломать подписку. */
    }
    emit('malformed')
  }
  function codeOf(value: { errorCode?: number }) {
    return typeof value.errorCode === 'number'
      && Number.isFinite(value.errorCode)
      ? value.errorCode
      : undefined
  }

  subscription.onservicecallback = (message) => {
    const value = parse(message)
    if (!value)
      return
    // Отказ может содержать timestamp: сначала проверяем результат регистрации.
    if (value.returnValue === false) {
      emit('register-failed', codeOf(value))
      return
    }
    if (
      typeof value.timestamp !== 'number'
      && typeof value.timestamp !== 'string'
    ) {
      if (value.returnValue === true)
        emit('registered')
      return
    }
    // Метка непрозрачна: webOS присылает и строки, и числа, включая 0.
    // state может отсутствовать.
    responder ??= serviceBridge()
    if (!responder) {
      emit('response-failed')
      return
    }
    responder.onservicecallback = (response) => {
      const result = parse(response)
      if (!result)
        return
      if (result.returnValue === false)
        emit('response-failed', codeOf(result))
      else if (result.returnValue === true)
        emit('response-ok')
    }
    try {
      emit('response-sent')
      responder.call(
        `${TV_POWER}/responseScreenSaverRequest`,
        JSON.stringify({
          clientName: SCREENSAVER_CLIENT,
          ack: !held,
          timestamp: value.timestamp,
        }),
      )
    }
    catch {
      emit('response-failed')
    }
  }

  try {
    emit('register-sent')
    subscription.call(
      `${TV_POWER}/registerScreenSaverRequest`,
      JSON.stringify({ subscribe: true, clientName: SCREENSAVER_CLIENT }),
    )
  }
  catch {
    emit('register-failed')
  }

  // Даже запоздавший callback после cancel получает ack=true.
  return () => {
    if (released)
      return
    held = false
    released = true
    emit('release')
    try {
      subscription.cancel()
    }
    catch {
      /* Мост уже закрыт. */
    }
  }
}

/**
 * Выход из приложения по Back с первого экрана: на webOS 6+ система сама
 * спрашивает о выходе, на webOS 5 открывает Home. Вне webOS ничего не делает.
 */
export function exitApp() {
  const palm = window.PalmSystem
  if (palm?.platformBack)
    palm.platformBack()
  else if (palm)
    window.close()
}

/** Витрина открыта в приложении webOS: системный плеер играет MKV и AC3 */
export function isWebos() {
  return !!window.PalmSystem
}
