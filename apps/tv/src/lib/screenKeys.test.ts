import { describe, expect, it } from 'vitest'
import { createScreenKeys } from './screenKeys.ts'

const TITLE = '/title/tmdb:movie:27205'
const PERSON = '/person/tmdb:person:6193'

describe('createScreenKeys', () => {
  it('возврат по истории — тот же экран, переход вперёд — новый', () => {
    const keyOf = createScreenKeys()
    const title = keyOf(1, TITLE, false)
    const person = keyOf(2, PERSON, false)

    expect(person).not.toBe(title)
    expect(keyOf(1, TITLE, true)).toBe(title)
    expect(keyOf(2, PERSON, true)).toBe(person)
  })

  it('тот же тайтл дальше в цепочке — новый экран', () => {
    const keyOf = createScreenKeys()
    const first = keyOf(1, TITLE, false)

    keyOf(2, PERSON, false)
    expect(keyOf(3, TITLE, false)).not.toBe(first)
  })

  it('та же позиция после нового перехода — новый экран', () => {
    const keyOf = createScreenKeys()

    keyOf(1, TITLE, false)
    const person = keyOf(2, PERSON, false)

    keyOf(1, TITLE, true)
    expect(keyOf(2, PERSON, false)).not.toBe(person)
  })

  it('replace на той же записи — новый экран', () => {
    const keyOf = createScreenKeys()
    const title = keyOf(3, TITLE, false)

    expect(keyOf(3, TITLE, false)).not.toBe(title)
  })

  it('переход вперёд забывает записи впереди', () => {
    const keyOf = createScreenKeys()

    keyOf(1, TITLE, false)
    const deep = keyOf(3, PERSON, false)

    keyOf(1, TITLE, true)
    keyOf(2, TITLE, false)
    expect(keyOf(3, PERSON, true)).not.toBe(deep)
  })

  it('шаг по истории на другой путь той же позиции — новый экран', () => {
    const keyOf = createScreenKeys()
    const title = keyOf(0, TITLE, false)

    expect(keyOf(0, PERSON, true)).not.toBe(title)
  })
})
