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

/**
 * Не пускает системную заставку webOS, пока не снято удержание: перед её
 * включением tvpower спрашивает подписчиков, ответ `ack: false` её отменяет.
 * API недокументирован, поэтому без гарантий: нет моста или вызов отклонён —
 * молча ничего. Вне webOS ничего не делает. Возвращает снятие удержания.
 */
export function holdSystemScreensaver(): () => void {
  const subscription = serviceBridge()

  if (!subscription)
    return () => {}

  let held = true
  let responder: ServiceBridge | undefined

  subscription.onservicecallback = (message) => {
    let timestamp: unknown

    try {
      timestamp = (JSON.parse(message) as { timestamp?: unknown }).timestamp
    }
    catch {
      return
    }

    // Ждём запрос с меткой времени, а не `state: 'Active'`: на части прошивок
    // `state` в запросе нет, и без ответа заставка включается
    if (timestamp === undefined)
      return

    responder ??= serviceBridge()
    responder?.call(
      `${TV_POWER}/responseScreenSaverRequest`,
      JSON.stringify({ clientName: SCREENSAVER_CLIENT, ack: !held, timestamp }),
    )
  }

  try {
    subscription.call(
      `${TV_POWER}/registerScreenSaverRequest`,
      JSON.stringify({ subscribe: true, clientName: SCREENSAVER_CLIENT }),
    )
  }
  catch {
    return () => {}
  }

  // Запрос, который успеет прийти до отмены подписки, получит `ack: true`
  return () => {
    held = false

    try {
      subscription.cancel()
    }
    catch {
      // Мост уже закрыт: держать нечего
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
