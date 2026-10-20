import { describe, expect, it } from 'vitest'
import { addRecent, loadRecent, saveRecent } from './recentSearches.ts'

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()

  if (initial !== undefined)
    values.set('torsher.recentSearches', initial)

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('addRecent', () => {
  it('ставит запрос сверху без пробелов и повторов', () => {
    expect(addRecent(['дюна', 'Severance'], '  severance ')).toEqual([
      'severance',
      'дюна',
    ])
  })

  it('пустой запрос не меняет список', () => {
    const list = ['дюна']

    expect(addRecent(list, '   ')).toBe(list)
  })

  it('держит не больше предела', () => {
    expect(addRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
})

describe('хранилище', () => {
  it('сохраняет и читает список', () => {
    const storage = memoryStorage()

    saveRecent(['дюна'], storage)

    expect(loadRecent(storage)).toEqual(['дюна'])
  })

  it('битые данные и чужие типы — пустой или очищенный список', () => {
    expect(loadRecent(memoryStorage('{oops'))).toEqual([])
    expect(loadRecent(memoryStorage('{"a":1}'))).toEqual([])
    expect(loadRecent(memoryStorage('["дюна", 5]'))).toEqual(['дюна'])
  })

  it('отказ хранилища не роняет экран', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }

    expect(loadRecent(broken)).toEqual([])
    expect(() => saveRecent(['дюна'], broken)).not.toThrow()
  })

  it('без хранилища — пусто', () => {
    expect(loadRecent(undefined)).toEqual([])
  })
})
