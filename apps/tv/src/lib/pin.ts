export const PIN_LENGTH = 4

/** Цифра в PIN; пятая не добавляется */
export function pushDigit(pin: string, digit: number) {
  return pin.length < PIN_LENGTH ? `${pin}${digit}` : pin
}

export function popDigit(pin: string) {
  return pin.slice(0, -1)
}

/** Сколько целых минут осталось до конца блокировки, не меньше одной */
export function minutesLeft(lockedUntil: number, now: number) {
  return Math.max(1, Math.ceil((lockedUntil - now) / 60_000))
}
