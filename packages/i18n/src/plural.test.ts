import { describe, expect, it } from 'vitest'
import { pluralRules } from './plural.ts'

describe('русские формы', () => {
  const rule = pluralRules.ru_RU!

  it.each([
    [1, 0],
    [21, 0],
    [2, 1],
    [4, 1],
    [23, 1],
    [0, 2],
    [5, 2],
    [11, 2],
    [12, 2],
    [14, 2],
    [111, 2],
  ])('%i → форма %i', (count, form) => {
    expect(rule(count, 3)).toBe(form)
  })
})
