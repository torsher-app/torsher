/**
 * Журнал ввода для отладки на ТВ: какие события шлёт пульт и указка, с какими
 * кодами и через сколько миллисекунд друг после друга. Поля читаются как есть,
 * без нормализации: важно увидеть, что пришло на самом деле.
 */
export interface InputEventLike {
  type: string
  keyCode?: number
  key?: string
  repeat?: boolean
  button?: number
  detail?: unknown
  target?: unknown
}

export const INPUT_LOG_SIZE = 16

function describeTarget(target: unknown) {
  if (!target || typeof target !== 'object' || !('tagName' in target))
    return ''

  const { tagName, className } = target as {
    tagName: string
    className?: unknown
  }
  // У SVG className — объект, не строка
  const first
    = typeof className === 'string' ? className.split(' ')[0] : undefined

  return ` ${tagName.toLowerCase()}${first ? `.${first}` : ''}`
}

/** Одна строка журнала: тип события и поля, по которым его различаем */
export function describeInput(event: InputEventLike): string {
  if (event.keyCode !== undefined) {
    return `${event.type} ${event.keyCode} key=${event.key ?? ''}${
      event.repeat ? ' repeat' : ''
    }`
  }

  if (event.button !== undefined) {
    // detail у click — число нажатий: у мыши 1 и больше, у click() из кода 0
    return `${event.type} button=${event.button} detail=${String(event.detail)}${describeTarget(event.target)}`
  }

  if (event.type === 'cursorStateChange') {
    const visibility = (event.detail as { visibility?: boolean } | null)
      ?.visibility

    return `cursorStateChange visibility=${String(visibility)}`
  }

  return `${event.type}${describeTarget(event.target)}`
}

/**
 * `count` нажатий подряд за `windowMs` — тайное сочетание. Любая другая
 * клавиша или пауза начинает отсчёт заново.
 */
export function createTapCounter(count: number, windowMs: number) {
  let taps: number[] = []

  return function tap(matches: boolean, now: number) {
    if (!matches) {
      taps = []

      return false
    }

    taps = [...taps.filter(at => now - at < windowMs), now]

    if (taps.length < count)
      return false

    taps = []

    return true
  }
}
