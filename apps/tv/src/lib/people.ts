import type { CrewMember, PersonDetails } from '@torsher/api-client'
import { parseAirDate } from './titleInfo.ts'

type CrewJob = CrewMember['jobs'][number]
type PersonRole = PersonDetails['credits'][number]['role']

type Translate = (key: string) => string

// «Режиссёр, сценарий»: с заглавной только первое слово
function joinCapitalized(words: string[]) {
  return words
    .map((word, index) =>
      index === 0 ? word : word.charAt(0).toLowerCase() + word.slice(1),
    )
    .join(', ')
}

/** Должности человека в съёмочной группе одной строкой: «Режиссёр, сценарий». */
export function crewCaption(jobs: CrewJob[], t: Translate) {
  return joinCapitalized(jobs.map(job => t(`crew.jobs.${job}`)))
}

/** Роли персоны в шапке: «Режиссёр, сценарист, продюсер». */
export function rolesLine(roles: PersonRole[], t: Translate) {
  return joinCapitalized(roles.map(role => t(`person.roles.${role}`)))
}

/**
 * Полных лет на дату смерти или на сегодня; даты TMDB — YYYY-MM-DD.
 * `undefined` — даты нет или она не разбирается.
 */
export function ageOf(birthday: string, deathday?: string, now = new Date()) {
  const born = parseAirDate(birthday)
  const until = deathday ? parseAirDate(deathday) : now

  if (Number.isNaN(born.getTime()) || Number.isNaN(until.getTime()))
    return undefined

  const birthdayPassed
    = until.getMonth() > born.getMonth()
      || (until.getMonth() === born.getMonth() && until.getDate() >= born.getDate())
  const age
    = until.getFullYear() - born.getFullYear() - (birthdayPassed ? 0 : 1)

  return age >= 0 ? age : undefined
}
