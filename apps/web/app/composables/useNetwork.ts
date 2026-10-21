import type {
  CreateNetRouteInput,
  DnsProviderList,
  NetCheckState,
  NetRoute,
  NetRouteErrorResponse,
  UpdateNetRouteInput,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

export type DnsProvider = DnsProviderList['items'][number]

const POLL_INTERVAL_MS = 1000
// Хост отвечает до 8 с, хостов немного: дольше двух минут проверка не идёт
const POLL_LIMIT_MS = 2 * 60 * 1000

const routes = shallowRef<NetRoute[]>([])
const check = shallowRef<NetCheckState | null>(null)
const providers = shallowRef<DnsProvider[]>([])
const state = ref<LoadState>('idle')
let pollTimer: ReturnType<typeof setTimeout> | undefined
// Кто ждёт конца опроса: «Проверить все» показывает итог тостом
let waiters: ((value: NetCheckState | null) => void)[] = []

function isBusy(value: NetCheckState | null) {
  return Boolean(
    value && (value.running || value.hosts.some(host => host.checking)),
  )
}

async function load() {
  state.value = 'loading'

  try {
    const [routeList, checkState, providerList] = await withErrorMode(
      'silent',
      () =>
        Promise.all([
          api.net.getNetRoutes(),
          api.net.getNetCheck(),
          api.net.getNetDnsProviders(),
        ]),
    )

    routes.value = routeList.items
    check.value = checkState
    providers.value = providerList.items
    state.value = 'ready'

    if (isBusy(checkState))
      poll()
  }
  catch {
    state.value = 'error'
  }
}

function settle(value: NetCheckState | null) {
  const pending = waiters

  waiters = []
  pending.forEach(resolve => resolve(value))
}

function poll() {
  clearTimeout(pollTimer)

  const startedAt = Date.now()

  const tick = async () => {
    try {
      check.value = await withErrorMode('silent', () => api.net.getNetCheck())
    }
    catch {
      stopPolling()
      return
    }

    if (isBusy(check.value) && Date.now() - startedAt < POLL_LIMIT_MS) {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
      return
    }

    pollTimer = undefined
    settle(check.value)
  }

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

function stopPolling() {
  clearTimeout(pollTimer)
  pollTimer = undefined
  settle(null)
}

/**
 * Проверка идёт на сервере: ответ — состояние, дальше его опрашиваем.
 * `done` отдаёт итог, когда проверка закончится; уход со страницы — `null`.
 */
async function checkAll() {
  check.value = await api.net.postNetCheck({})

  const done = new Promise<NetCheckState | null>(resolve =>
    waiters.push(resolve),
  )

  poll()

  return { done }
}

async function checkHost(id: string) {
  check.value = await api.net.postNetCheck({ host: id })
  poll()
}

/** Маршрут хоста меняется вместе с маршрутами: перечитываем состояние проверки */
async function refreshCheck() {
  check.value = await withErrorMode('silent', () =>
    api.net.getNetCheck()).catch(() => check.value)
}

function replaceRoute(route: NetRoute) {
  routes.value = routes.value.map(item =>
    item.id === route.id ? route : item,
  )
}

async function createRoute(input: CreateNetRouteInput) {
  const created = await withErrorMode('silent', () =>
    api.net.postNetRoute(input))

  routes.value = (await api.net.getNetRoutes()).items
  await refreshCheck()

  return created
}

async function updateRoute(id: string, patch: UpdateNetRouteInput) {
  const updated = await withErrorMode('silent', () =>
    api.net.patchNetRoute(id, patch))

  replaceRoute(updated)
  await refreshCheck()

  return updated
}

async function deleteRoute(id: string) {
  await api.net.deleteNetRoute(id)
  routes.value = routes.value.filter(item => item.id !== id)
  await refreshCheck()
}

/** Сдвиг на одну позицию; `*` всегда последним и не двигается */
async function moveRoute(id: string, offset: -1 | 1) {
  const movable = routes.value.filter(item => !item.isDefault)
  const index = movable.findIndex(item => item.id === id)
  const target = index + offset

  if (index < 0 || target < 0 || target >= movable.length)
    return

  const ids = movable.map(item => item.id);

  [ids[index], ids[target]] = [ids[target]!, ids[index]!]
  routes.value = (await api.net.putNetRouteOrder({ ids })).items
  await refreshCheck()
}

/** Ошибка сохранения маршрута с полем, к которому она относится (422) */
export async function netRouteError(err: unknown) {
  if (getErrorStatus(err) !== 422)
    return null

  return (await getErrorBody<NetRouteErrorResponse>(err)) ?? null
}

export function useNetwork() {
  return {
    routes: computed(() => routes.value),
    defaultRoute: computed(
      () => routes.value.find(item => item.isDefault) ?? null,
    ),
    check: computed(() => check.value),
    isChecking: computed(() => isBusy(check.value)),
    providers: computed(() => providers.value),
    state: readonly(state),
    load,
    checkAll,
    checkHost,
    stopPolling,
    createRoute,
    updateRoute,
    deleteRoute,
    moveRoute,
  }
}
