import { describe, expect, it } from 'vitest'
import { ageOf, crewCaption, rolesLine } from './people.ts'

const labels: Record<string, string> = {
  'crew.jobs.director': 'Режиссёр',
  'crew.jobs.writer': 'Сценарий',
  'person.roles.directing': 'Режиссёр',
  'person.roles.writing': 'Сценарист',
  'person.roles.production': 'Продюсер',
}

function t(key: string) {
  return labels[key] ?? key
}

describe('подписи людей', () => {
  it('должности через запятую, с заглавной только первая', () => {
    expect(crewCaption(['director', 'writer'], t)).toBe('Режиссёр, сценарий')
    expect(crewCaption(['writer'], t)).toBe('Сценарий')
  })

  it('роли в шапке персоны', () => {
    expect(rolesLine(['directing', 'writing', 'production'], t)).toBe(
      'Режиссёр, сценарист, продюсер',
    )
  })
})

describe('ageOf', () => {
  const now = new Date(2026, 9, 23)

  it('полных лет на сегодня: день рождения ещё не наступил', () => {
    expect(ageOf('1970-10-24', undefined, now)).toBe(55)
    expect(ageOf('1970-10-23', undefined, now)).toBe(56)
  })

  it('у умершего — на дату смерти', () => {
    expect(ageOf('1946-02-21', '2016-01-14', now)).toBe(69)
  })

  it('битая дата — undefined', () => {
    expect(ageOf('unknown', undefined, now)).toBeUndefined()
  })
})
