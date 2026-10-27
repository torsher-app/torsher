import type { PlayerSnapshot } from '../lib/nativeVideo.ts'

/** Объект, который оболочка Android кладёт в страницу до её скриптов */
interface TorsherShell {
  platform: string
  version: string
  /** Имя объекта моста в `window` */
  bridge: string
  /** Видео играет нативный плеер оболочки, а не `<video>` страницы */
  nativePlayer?: boolean
  /** Что умеет нативный плеер: его профиль уходит в `POST /playback` */
  deviceProfile?: unknown
}

/** Мост `WebViewCompat.addWebMessageListener`: строки в обе стороны */
interface ShellBridge {
  postMessage: (message: string) => void
  onmessage: ((event: MessageEvent<string>) => void) | null
}

declare global {
  interface Window {
    TorsherShell?: TorsherShell
  }
}

export type PlayerCommand
  = | { type: 'player.load', url: string }
    | { type: 'player.play' }
    | { type: 'player.pause' }
    | { type: 'player.seek', time: number }
    | { type: 'player.rate', rate: number }
    | { type: 'player.audio', index: number }
    | { type: 'player.stop' }

type ShellMessage
  = | { type: 'ready' }
    | { type: 'back.unhandled' }
    | { type: 'server.change' }
    | { type: 'screen.keepOn', on: boolean }
    | PlayerCommand

function bridge(): ShellBridge | undefined {
  const shell = window.TorsherShell

  if (shell?.platform !== 'android')
    return undefined

  return (window as unknown as Record<string, ShellBridge | undefined>)[
    shell.bridge
  ]
}

const shellBridge = bridge()

/** Витрина открыта в оболочке Android TV и мост доступен */
export const isAndroidShell = !!shellBridge

/** Видео играет Media3 оболочки: плеер витрины отдаёт ему поток */
export const hasNativePlayer
  = isAndroidShell && window.TorsherShell?.nativePlayer === true

/** Профиль нативного плеера; вне оболочки — undefined */
export function nativeDeviceProfile() {
  return hasNativePlayer ? window.TorsherShell?.deviceProfile : undefined
}

function post(message: ShellMessage) {
  shellBridge?.postMessage(JSON.stringify(message))
}

export function postPlayer(command: PlayerCommand) {
  post(command)
}

let playerListener: ((snapshot: PlayerSnapshot) => void) | undefined

/** Снимки нативного плеера получает один `<video>` — экран плеера */
export function onPlayerState(listener?: (snapshot: PlayerSnapshot) => void) {
  playerListener = listener
}

/**
 * Back и медиакнопки WebView в страницу не передаёт: их ловит Activity и
 * присылает событием `key`. Витрина разбирает его как клавишу пульта — с
 * перехватами экранов и плеера.
 */
function dispatchKey(keyCode: number) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
  })
  // keyCode в KeyboardEventInit старые Chromium не принимают
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });

  (document.activeElement ?? document.body).dispatchEvent(event)
}

/** Подключить мост: с этого момента Back и медиакнопки оболочка отдаёт витрине */
export function connectAndroidShell() {
  if (!shellBridge)
    return

  shellBridge.onmessage = (event) => {
    let message: { type?: unknown, keyCode?: unknown }

    try {
      message = JSON.parse(event.data) as typeof message
    }
    catch {
      return
    }

    if (message.type === 'key' && typeof message.keyCode === 'number')
      dispatchKey(message.keyCode)
    else if (message.type === 'player.state')
      playerListener?.(message as unknown as PlayerSnapshot)
  }

  post({ type: 'ready' })
}

/** Back на первом экране: выход из приложения */
export function exitAndroidApp() {
  post({ type: 'back.unhandled' })
}

/** «Сменить сервер»: экран адреса оболочки */
export function changeAndroidServer() {
  post({ type: 'server.change' })
}

let screenHolds = 0

/**
 * Экран не гаснет, пока держит хоть кто-то. Возвращает снятие удержания;
 * повторный вызов снятия ничего не делает.
 */
export function holdAndroidScreen(): () => void {
  if (!shellBridge)
    return () => {}

  if (screenHolds++ === 0)
    post({ type: 'screen.keepOn', on: true })

  let held = true

  return () => {
    if (!held)
      return

    held = false

    if (--screenHolds === 0)
      post({ type: 'screen.keepOn', on: false })
  }
}
