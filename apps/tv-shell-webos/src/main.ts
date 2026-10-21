import './styles.css'
import type { CheckResult } from './server.ts'
import { KEY, moveFocus } from './focus.ts'
import { format, resolveMessages } from './i18n.ts'
import {
  checkServer,
  displayAddress,
  normalizeAddress,
  showcaseUrl,
} from './server.ts'
import {
  isHistoryNavigation,
  shellHistoryIndex,
  startScreen,
} from './startup.ts'
import { loadServer, saveServer } from './storage.ts'
import { exitApp } from './webos.ts'

const t = resolveMessages(
  navigator.languages?.length ? navigator.languages : [navigator.language],
)

function byId<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T
}

const addressScreen = byId('address-screen')
const connectScreen = byId('connect-screen')
const form = byId<HTMLFormElement>('address-form')
const input = byId<HTMLInputElement>('address')
const error = byId('error')
const connecting = byId('connecting')
const connectButton = byId<HTMLButtonElement>('connect')
const change = byId<HTMLButtonElement>('change')

byId('tagline').textContent = t.tagline
byId('address-label').textContent = t.addressLabel
byId('address-hint').textContent = t.addressHint
connectButton.textContent = t.connect
change.textContent = t.changeAddress
input.placeholder = '192.168.1.10:8080'

// Ответ прежней попытки, которую отменили «Сменить адрес», игнорируется
let attempt = 0

function errorText(result: Exclude<CheckResult, 'ok'>, base: string) {
  return format(t.errors[result], { address: displayAddress(base) })
}

function showAddress(message = '', focusOn?: HTMLElement) {
  attempt++
  connectScreen.hidden = true
  addressScreen.hidden = false
  error.textContent = message
  error.hidden = !message

  // Сервер не ответил по готовому адресу — проще повторить: фокус на кнопке
  const target = focusOn ?? (message && input.value ? connectButton : input)
  target.focus()
}

async function connect(base: string) {
  const current = ++attempt
  addressScreen.hidden = true
  connectScreen.hidden = false
  connecting.textContent = format(t.connecting, {
    address: displayAddress(base),
  })
  change.focus()

  const result = await checkServer(base)
  if (current !== attempt)
    return

  if (result === 'ok') {
    saveServer(base)
    // assign, а не replace: «Сменить сервер» в витрине возвращается сюда по истории
    window.location.assign(
      showcaseUrl(base, shellHistoryIndex(window.history)),
    )
    return
  }

  showAddress(errorText(result, base))
}

form.addEventListener('submit', (event) => {
  event.preventDefault()

  const base = normalizeAddress(input.value)
  if (base) {
    input.value = displayAddress(base)
    void connect(base)
  }
  else {
    showAddress(t.errors.invalid, input)
  }
})

change.addEventListener('click', () => showAddress())

document.addEventListener('keydown', (event) => {
  switch (event.keyCode) {
    case KEY.up:
    case KEY.down:
      // В поле стрелки вверх и вниз не нужны: строка одна
      event.preventDefault()
      moveFocus(event.keyCode === KEY.up ? -1 : 1)
      break
    case KEY.back:
    case KEY.escape:
      event.preventDefault()
      if (!connectScreen.hidden)
        showAddress()
      else if (event.keyCode === KEY.back)
        exitApp()
      break
  }
})

// Chromium может вернуть страницу из кэша истории, не выполняя скрипт заново
window.addEventListener('pageshow', (event) => {
  if (event.persisted)
    showAddress()
})

const saved = loadServer()
if (saved)
  input.value = displayAddress(saved)

if (saved && startScreen(saved, isHistoryNavigation()) === 'connect')
  void connect(saved)
else showAddress()
