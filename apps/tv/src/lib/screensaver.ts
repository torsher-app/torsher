/** Через сколько минут простоя включается заставка; 0 — выключена. */
export const SCREENSAVER_OPTIONS = [0, 2, 5, 10, 15, 30] as const
export const DEFAULT_SCREENSAVER_MINUTES = 5
// Кадр стоит столько, сколько длится его медленный наезд
export const SLIDE_MS = 20_000

const STORAGE_KEY = 'torsher.screensaver'

/**
 * Дольше заставка экран не держит: гаснет в чёрный и отдаёт его ТВ, чтобы тот
 * включил свою заставку и выключился по своему таймеру.
 */
export const SCREENSAVER_HOLD_MS = 60 * 60_000

/** Пора ли включать заставку: простой не меньше заданного, заставка не выключена. */
export function idleDue(lastInputAt: number, now: number, minutes: number) {
  return minutes > 0 && now - lastInputAt >= minutes * 60_000
}

/** Заставка идёт дольше предела: кадры гаснут, удержание экрана снимается. */
export function screensaverRests(activeSince: number, now: number) {
  return now - activeSince >= SCREENSAVER_HOLD_MS
}

/** Порядок кадров: перемешанный, первым не стоит тот, что показывали последним. */
export function shuffled<T>(
  items: readonly T[],
  random: () => number = Math.random,
  avoidFirst?: T,
) {
  const list = items.slice()

  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = list[i]!

    list[i] = list[j]!
    list[j] = swap
  }

  if (list.length > 1 && list[0] === avoidFirst)
    list.push(list.shift()!)

  return list
}

// Подпись и часы обходят углы по кругу: на OLED выгорает и неподвижный текст
const CORNERS = ['bottomLeft', 'topRight', 'bottomRight', 'topLeft'] as const

export type ScreensaverCorner = (typeof CORNERS)[number]

export function cornerOf(slide: number): ScreensaverCorner {
  return CORNERS[slide % CORNERS.length]!
}

/**
 * Время заставки — настройка этого устройства: выгорает конкретная панель, а не
 * зритель. Хранилище недоступно или значение чужое — по умолчанию.
 */
export function loadScreensaverMinutes(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = Number(raw)

    // Number(null) — 0, то есть «выключена»: без записи это не выбор
    return raw !== null
      && (SCREENSAVER_OPTIONS as readonly number[]).includes(value)
      ? value
      : DEFAULT_SCREENSAVER_MINUTES
  }
  catch {
    return DEFAULT_SCREENSAVER_MINUTES
  }
}

export function saveScreensaverMinutes(minutes: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(minutes))
  }
  catch {
    // Не запомнилось — после перезапуска снова значение по умолчанию
  }
}
