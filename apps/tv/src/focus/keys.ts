import type { Direction } from './geometry.ts'

// На webOS и Tizen надёжен только keyCode: event.key для кнопок пульта пустой или нестандартный
const DIRECTIONS: Record<number, Direction> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
}

const ENTER = 13
// PageUp и PageDown: клавиатура и пульты, которые их шлют. CH+/CH− пульта LG
// приложениям не приходят, поэтому листание экранами — не единственный путь
const PAGES: Record<number, 'up' | 'down'> = {
  33: 'up',
  34: 'down',
}
// Клавиша контекстного меню в браузере
const CONTEXT_MENU = 93
// Android TV: Back и медиакнопки ловит Activity оболочки и присылает этими
// кодами (KEYCODE_BACK в Chromium — VKEY_BROWSER_BACK)
export const ANDROID_BACK = 166
const BACK = new Set([
  461, // webOS
  10009, // Tizen
  ANDROID_BACK,
  27, // Escape в браузере
  8, // Backspace в браузере
])

// Медиакнопки пульта webOS и Android TV, пробел в браузере. Коды Android —
// перевод KEYCODE_MEDIA_* в Chromium (keyboard_code_conversion_android.cc);
// Play и Pause оболочка присылает кодами webOS
const MEDIA: Record<number, MediaKey> = {
  415: 'play',
  19: 'pause',
  413: 'stop',
  417: 'forward',
  412: 'rewind',
  179: 'playPause',
  178: 'stop',
  228: 'forward',
  227: 'rewind',
  32: 'playPause',
}

export type MediaKey
  = 'play' | 'pause' | 'playPause' | 'stop' | 'forward' | 'rewind'

// Цифры: верхний ряд клавиатуры и пульта — 48–57, цифровой блок — 96–105
const DIGIT_0 = 48
const NUMPAD_0 = 96

export type KeyAction
  = | { type: 'move', direction: Direction }
    | { type: 'enter' }
    | { type: 'back' }
    | { type: 'page', direction: 'up' | 'down' }
    | { type: 'media', key: MediaKey }
    | { type: 'digit', digit: number }
    | { type: 'menu' }

function digitOf(keyCode: number) {
  if (keyCode >= DIGIT_0 && keyCode <= DIGIT_0 + 9)
    return keyCode - DIGIT_0

  if (keyCode >= NUMPAD_0 && keyCode <= NUMPAD_0 + 9)
    return keyCode - NUMPAD_0

  return undefined
}

function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  )
}

export function readKey(event: KeyboardEvent): KeyAction | undefined {
  const direction = DIRECTIONS[event.keyCode]
  const inTextField = isTextField(event.target)

  if (direction) {
    // Влево и вправо в поле ввода двигают курсор, а не фокус
    if (inTextField && (direction === 'left' || direction === 'right'))
      return undefined

    return { type: 'move', direction }
  }

  if (event.keyCode === ENTER && !inTextField)
    return { type: 'enter' }

  if (event.keyCode === CONTEXT_MENU && !inTextField)
    return { type: 'menu' }

  const page = PAGES[event.keyCode]

  if (page && !inTextField)
    return { type: 'page', direction: page }

  if (BACK.has(event.keyCode) && !(inTextField && event.keyCode === 8))
    return { type: 'back' }

  const media = MEDIA[event.keyCode]

  if (media && !inTextField)
    return { type: 'media', key: media }

  const digit = digitOf(event.keyCode)

  // Цифры без экрана, который их ждёт (PIN), ничего не делают
  if (digit !== undefined && !inTextField && !event.shiftKey)
    return { type: 'digit', digit }

  return undefined
}
