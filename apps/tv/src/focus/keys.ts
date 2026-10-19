import type { Direction } from './geometry.ts'

// На webOS и Tizen надёжен только keyCode: event.key для кнопок пульта пустой или нестандартный
const DIRECTIONS: Record<number, Direction> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
}

const ENTER = 13
const BACK = new Set([
  461, // webOS
  10009, // Tizen
  27, // Escape в браузере
  8, // Backspace в браузере
])

export type KeyAction
  = { type: 'move', direction: Direction } | { type: 'enter' } | { type: 'back' }

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

  if (BACK.has(event.keyCode) && !(inTextField && event.keyCode === 8))
    return { type: 'back' }

  return undefined
}
