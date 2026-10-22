import type { ProfileList } from '@torsher/api-client'

/**
 * Где витрина в подключении: `unpaired` — ни сессии владельца, ни токена
 * устройства; `choosing` — подключена, профиль на устройстве не выбран;
 * `ready` — можно смотреть. `unknown` — сервер ещё не спрашивали.
 */
export type SessionStatus = 'unknown' | 'unpaired' | 'choosing' | 'ready'

export interface GateTarget {
  path: string
  query?: { next: string }
}

const CONNECT = '/connect'
const PROFILES = '/profiles'
// «О программе» открыта всегда: там версия, атрибуция и «Сменить сервер»
const ABOUT = '/about'

/** Путь витрины для возврата после подключения: только внутренний */
export function safeNext(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    ? value
    : undefined
}

// Экраны подключения передают `next` дальше, остальные сами становятся им
function nextOf(
  path: string,
  fullPath: string,
  query: Record<string, unknown>,
) {
  const next
    = path === CONNECT || path === PROFILES ? safeNext(query.next) : fullPath

  return next && next !== '/' ? { next } : undefined
}

/**
 * Куда увести переход, пока витрина не подключена или профиль не выбран.
 * `undefined` — переход идёт как есть.
 */
export function gateTarget(
  status: SessionStatus,
  route: { path: string, fullPath: string, query: Record<string, unknown> },
): GateTarget | undefined {
  const { path } = route

  if (path === ABOUT || status === 'unknown')
    return undefined

  if (status === 'unpaired') {
    return path === CONNECT
      ? undefined
      : { path: CONNECT, query: nextOf(path, route.fullPath, route.query) }
  }

  if (status === 'choosing') {
    return path === PROFILES
      ? undefined
      : { path: PROFILES, query: nextOf(path, route.fullPath, route.query) }
  }

  // Подключённой витрине экран кода не нужен
  return path === CONNECT
    ? { path: safeNext(route.query.next) ?? '/' }
    : undefined
}

/**
 * Профиль, который выбирается без экрана выбора: единственный и без PIN.
 * Спрашивать «Кто смотрит?» с одним вариантом незачем.
 */
export function autoProfile(list: ProfileList) {
  const [only] = list.items

  return list.items.length === 1 && only && !only.hasPin ? only : undefined
}
