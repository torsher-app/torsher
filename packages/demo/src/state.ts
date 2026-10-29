/**
 * Общее состояние демо панели и витрины. Живёт до перезагрузки страницы:
 * каждый раздел держит свои данные в модуле `handlers/*` приложения, здесь —
 * только то, что нужно всем.
 */

export type Scenario = 'lived' | 'fresh'

/**
 * `lived` — установка, которой уже пользуются: библиотека, загрузки,
 * источники. `fresh` — только что поставленный сервер: аккаунта нет,
 * открывается мастер первого запуска
 */
export const scenario: Scenario
  = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('scenario') === 'fresh'
    ? 'fresh'
    : 'lived'

export const isFresh = scenario === 'fresh'

const startedAt = Date.now()

/** Секунды с открытия демо: по ним «идут» загрузки, перенос и журнал */
export function elapsedSeconds() {
  return (Date.now() - startedAt) / 1000
}

/** Момент `seconds` назад в ISO, как даты в ответах сервера */
export function ago(seconds: number) {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

export const MINUTE = 60
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

let lastId = 0

/** Новый id для созданной в демо сущности */
export function nextId(prefix: string) {
  lastId += 1
  return `${prefix}-demo-${lastId}`
}

export const GB = 1024 ** 3
export const MB = 1024 ** 2

/** Версия в «О программе» и «Обзоре» — версия продукта, из которой собрано демо */
export { version as DEMO_VERSION } from '../../../apps/server/package.json'
