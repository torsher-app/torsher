import { deleteSetting, getSetting, setSetting } from '../../settings/index.ts'

const STATE_KEY = 'imdbRatings'
const ENABLED_KEY = 'imdbRatingsEnabled'

export type ImdbErrorKind = 'unavailable' | 'invalid'

/** Последняя загрузка выгрузки. Время — ISO-строки: значение лежит в JSON */
export interface ImdbDatasetState {
  // Последняя попытка, удачная или нет: от неё отсчитывается повтор после ошибки
  attemptedAt?: string
  // Последний ответ IMDb без ошибки, в том числе 304
  checkedAt?: string
  // `Last-Modified` выгрузки, а без него — время скачивания
  updatedAt?: string
  etag?: string
  lastModified?: string
  count?: number
  error?: { kind: ImdbErrorKind, at: string }
}

export function isImdbEnabled() {
  return getSetting<boolean>(ENABLED_KEY) === true
}

export function setImdbEnabled(enabled: boolean) {
  setSetting(ENABLED_KEY, enabled)
}

export function readImdbState(): ImdbDatasetState {
  return getSetting<ImdbDatasetState>(STATE_KEY) ?? {}
}

export function writeImdbState(state: ImdbDatasetState) {
  setSetting(STATE_KEY, state)
}

export function clearImdbState() {
  deleteSetting(STATE_KEY)
}
