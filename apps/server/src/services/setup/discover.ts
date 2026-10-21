import type { IndexerManagerKind } from '../../db/schema.ts'
import { readFile } from 'node:fs/promises'
import { netFetch } from '../net/index.ts'

export interface DiscoveredManager {
  kind: IndexerManagerKind
  url: string
}

// Опрос идёт по адресам локальной сети: живой сервис отвечает за доли
// секунды, а мёртвый адрес не должен держать шаг мастера
export const DISCOVER_TIMEOUT_MS = 2500

const PORTS: Record<IndexerManagerKind, number> = {
  prowlarr: 9696,
  jackett: 9117,
}

/**
 * Проба без ключа: у обоих есть анонимный роут `{ "status": "OK" }`, и путь
 * у каждого свой — `/ping` у Prowlarr, `/health` у Jackett. На чужой путь
 * Prowlarr отдаёт HTML интерфейса, Jackett — 404, поэтому один не примет
 * себя за другого.
 */
const PROBE_PATHS: Record<IndexerManagerKind, string> = {
  prowlarr: '/ping',
  jackett: '/health',
}

/**
 * Шлюз сети контейнера из таблицы маршрутов Linux: через него виден порт,
 * опубликованный на хосте. Вне Linux таблицы нет — шлюз не ищем.
 */
export async function defaultGateway(
  read = () => readFile('/proc/net/route', 'utf8'),
): Promise<string | null> {
  let table: string

  try {
    table = await read()
  }
  catch {
    return null
  }

  for (const line of table.split('\n').slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/)

    if (destination !== '00000000' || !gateway || gateway === '00000000')
      continue

    // Адрес записан шестнадцатеричным числом в порядке байт little-endian
    const bytes = gateway
      .match(/../g)
      ?.map(byte => Number.parseInt(byte, 16))

    if (bytes?.length === 4 && bytes.every(byte => byte >= 0 && byte <= 255))
      return bytes.reverse().join('.')
  }

  return null
}

/**
 * Где обычно живут менеджеры: сервис compose с тем же именем, хост Docker
 * (Docker Desktop и `extra_hosts: host-gateway`), шлюз сети контейнера
 * и сама машина, если Torsher запущен без Docker. Порядок — от точного
 * к общему: из нескольких адресов одного менеджера берётся первый.
 */
export function candidateUrls(gateway: string | null) {
  const shared = ['host.docker.internal', gateway, '127.0.0.1'].filter(
    (host): host is string => Boolean(host),
  )

  return (Object.keys(PORTS) as IndexerManagerKind[]).flatMap(kind =>
    [kind, ...shared].map(host => ({
      kind,
      url: `http://${host}:${PORTS[kind]}`,
    })),
  )
}

async function probe(candidate: DiscoveredManager) {
  try {
    const res = await netFetch(
      `${candidate.url}${PROBE_PATHS[candidate.kind]}`,
      {
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
      },
    )

    if (!res.ok)
      return false

    const body = (await res.json()) as unknown

    return (
      typeof body === 'object'
      && body !== null
      && (body as { status?: unknown }).status === 'OK'
    )
  }
  catch {
    return false
  }
}

// Тесты подменяют шлюз: таблица маршрутов машины не должна влиять на адреса
export const discoverDeps = { gateway: () => defaultGateway() }

/** Опрашивает все адреса сразу; на каждый тип — первый ответивший по порядку */
export async function discoverManagers(): Promise<DiscoveredManager[]> {
  const candidates = candidateUrls(await discoverDeps.gateway())
  const found = await Promise.all(candidates.map(probe))
  const seen = new Set<IndexerManagerKind>()

  return candidates.filter((candidate, index) => {
    if (!found[index] || seen.has(candidate.kind))
      return false

    seen.add(candidate.kind)

    return true
  })
}
