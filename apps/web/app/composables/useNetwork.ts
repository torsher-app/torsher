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
let pollRevision = 0
let lifecycle: symbol | null = Symbol('network')
let checkRevision = 0
let checkRequest = 0
// Кто ждёт конца опроса: «Проверить все» показывает итог тостом
let waiters: ((value: NetCheckState | null) => void)[] = []

function isBusy(value: NetCheckState | null) {
  return Boolean(
    value && (value.running || value.hosts.some(host => host.checking)),
  )
}

async function load() {
  lifecycle ??= Symbol('network')
  const revision = checkRevision
  const request = ++checkRequest
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
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

    if (revision !== checkRevision || request !== checkRequest)
      return
    routes.value = routeList.items
    check.value = checkState
    providers.value = providerList.items
    state.value = 'ready'

    if (isBusy(checkState))
      poll()
  }
  catch {
    if (
      revision === checkRevision
      && request === checkRequest
      && state.value === 'loading'
    ) {
      state.value = 'error'
    }
  }
}

function settle(value: NetCheckState | null) {
  const pending = waiters

  waiters = []
  pending.forEach(resolve => resolve(value))
}

function cancelPoll() {
  pollRevision++
  clearTimeout(pollTimer)
  pollTimer = undefined
}

function poll() {
  cancelPoll()
  const owner = pollRevision
  const revision = checkRevision
  const startedAt = Date.now()
  const ownsPoll = () => owner === pollRevision && revision === checkRevision

  const tick = async () => {
    if (!ownsPoll())
      return
    const outcome = await refreshCheck(revision)
    if (!ownsPoll())
      return
    if (outcome === 'failed') {
      cancelPoll()
      settle(null)
      return
    }

    if (
      (outcome === 'stale' || isBusy(check.value))
      && Date.now() - startedAt < POLL_LIMIT_MS
    ) {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
      return
    }

    pollTimer = undefined
    // null finishedAt: маршруты сменились, итог старой проверки уже не актуален.
    settle(
      outcome === 'applied' && check.value?.finishedAt ? check.value : null,
    )
  }

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

function invalidateCheck() {
  checkRevision++
  cancelPoll()
  settle(null)
}

function stopPolling() {
  lifecycle = null
  invalidateCheck()
}

/**
 * Проверка идёт на сервере: ответ — состояние, дальше его опрашиваем.
 * `done` отдаёт итог, когда проверка закончится; уход со страницы — `null`.
 */
async function checkAll() {
  lifecycle ??= Symbol('network')
  invalidateCheck()
  const revision = checkRevision
  const next = await api.net.postNetCheck({})
  if (revision !== checkRevision)
    return { done: Promise.resolve(null) }
  checkRequest++
  check.value = next

  const done = new Promise<NetCheckState | null>(resolve =>
    waiters.push(resolve),
  )

  poll()

  return { done }
}

async function checkHost(id: string) {
  lifecycle ??= Symbol('network')
  const revision = checkRevision
  const next = await api.net.postNetCheck({ host: id })
  if (revision !== checkRevision)
    return
  checkRequest++
  check.value = next
  poll()
}

/** Маршрут хоста меняется вместе с маршрутами: перечитываем состояние проверки */
async function refreshCheck(revision: number) {
  if (revision !== checkRevision)
    return 'stale' as const
  const request = ++checkRequest
  const isCurrent = () =>
    revision === checkRevision && request === checkRequest
  try {
    const next = await withErrorMode('silent', () => api.net.getNetCheck())
    if (!isCurrent())
      return 'stale' as const
    check.value = next
    return 'applied' as const
  }
  catch {
    return isCurrent() ? ('failed' as const) : ('stale' as const)
  }
}

function replaceRoute(route: NetRoute) {
  routes.value = routes.value.map(item =>
    item.id === route.id ? route : item,
  )
}

async function mutateRoutes<T>(
  action: () => Promise<T>,
  apply: (value: T, sameLifecycle: () => boolean) => void | Promise<void>,
) {
  const started = lifecycle
  const revision = ++checkRevision
  cancelPoll()
  const sameLifecycle = () => started !== null && started === lifecycle
  // Маршрут обновляет список, но проверку уже мог запустить другой запрос.
  const ownsCheck = () => sameLifecycle() && revision === checkRevision
  try {
    const next = await action()
    if (ownsCheck()) {
      check.value = null
      settle(null)
    }
    if (sameLifecycle())
      await apply(next, sameLifecycle)
    return next
  }
  finally {
    if (ownsCheck()) {
      const outcome = await refreshCheck(revision)
      if (ownsCheck() && outcome !== 'stale') {
        if (outcome === 'failed' || isBusy(check.value))
          poll()
        else settle(check.value?.finishedAt ? check.value : null)
      }
    }
  }
}

function createRoute(input: CreateNetRouteInput) {
  return mutateRoutes(
    () => withErrorMode('silent', () => api.net.postNetRoute(input)),
    async (_created, sameLifecycle) => {
      const next = await api.net.getNetRoutes()
      if (sameLifecycle())
        routes.value = next.items
    },
  )
}

function updateRoute(id: string, patch: UpdateNetRouteInput) {
  return mutateRoutes(
    () => withErrorMode('silent', () => api.net.patchNetRoute(id, patch)),
    replaceRoute,
  )
}

async function deleteRoute(id: string) {
  await mutateRoutes(
    () => api.net.deleteNetRoute(id),
    () => {
      routes.value = routes.value.filter(item => item.id !== id)
    },
  )
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
  await mutateRoutes(
    () => api.net.putNetRouteOrder({ ids }),
    (next) => {
      routes.value = next.items
    },
  )
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
