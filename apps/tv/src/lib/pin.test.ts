import { describe, expect, it } from 'vitest'
import { minutesLeft, popDigit, pushDigit } from './pin.ts'

describe('pIN', () => {
  it('набирает до четырёх цифр и стирает последнюю', () => {
    expect(pushDigit('', 0)).toBe('0')
    expect(pushDigit('123', 4)).toBe('1234')
    expect(pushDigit('1234', 5)).toBe('1234')
    expect(popDigit('123')).toBe('12')
    expect(popDigit('')).toBe('')
  })

  it('минуты блокировки округляет вверх', () => {
    expect(minutesLeft(300_000, 0)).toBe(5)
    expect(minutesLeft(61_000, 0)).toBe(2)
    expect(minutesLeft(1000, 0)).toBe(1)
    expect(minutesLeft(0, 5000)).toBe(1)
  })
})
