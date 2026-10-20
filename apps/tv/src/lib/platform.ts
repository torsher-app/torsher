/**
 * `tv` — витрина внутри обёртки ТВ, `web` — в браузере. Меняет ввод и плотность,
 * компоновка общая.
 */
export type Platform = 'tv' | 'web'

/**
 * Обёртка ТВ открывает витрину с `?platform=tv`. Явный параметр вместо
 * угадывания по User-Agent: у браузеров ТВ он не отличается надёжно от десктопа.
 */
export function resolvePlatform(search: string): Platform {
  return new URLSearchParams(search).get('platform') === 'tv' ? 'tv' : 'web'
}
