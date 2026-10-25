import type { Device, PairingErrorResponse } from '@torsher/api-client'
import { getErrorBody } from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

export type PairingErrorKind = PairingErrorResponse['kind'] | 'unknown'

// «Смотрит сейчас» и время последнего запроса меняются сами: пока раздел
// открыт, список перечитывается
const POLL_INTERVAL_MS = 15_000
// Телевизор забирает токен при следующем опросе, через пару секунд после кода
const PAIRING_REFRESH_MS = [2000, 5000]

const devices = shallowRef<Device[]>([])
const state = ref<LoadState>('idle')

let pollTimer: ReturnType<typeof setInterval> | undefined

/** Вид ошибки подтверждения кода из ответа 422; остальное — `unknown` */
export async function pairingErrorKind(
  err: unknown,
): Promise<PairingErrorKind> {
  const body = await getErrorBody<Partial<PairingErrorResponse>>(err)

  return body?.kind ?? 'unknown'
}

async function fetchDevices() {
  devices.value = (
    await withErrorMode('silent', () => api.devices.getDevices())
  ).items
}

async function load() {
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    await fetchDevices()
    state.value = 'ready'
  }
  catch {
    if (state.value === 'loading')
      state.value = 'error'
  }
}

function refresh() {
  return fetchDevices().catch(() => {})
}

export function useDevices() {
  function startPolling() {
    stopPolling()
    pollTimer = setInterval(refresh, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    clearInterval(pollTimer)
    pollTimer = undefined
  }

  /** Ошибку кода показывает диалог: запрос в `silent` */
  async function confirmPairing(code: string, name: string) {
    const confirmed = await withErrorMode('silent', () =>
      api.devices.postDevicePairingConfirm({ code, name }))

    for (const delay of PAIRING_REFRESH_MS) setTimeout(refresh, delay)

    return confirmed
  }

  async function rename(id: string, name: string) {
    const updated = await api.devices.patchDevice(id, { name })

    devices.value = devices.value.map(item =>
      item.id === id ? updated : item,
    )

    return updated
  }

  async function revoke(id: string) {
    await api.devices.deleteDevice(id)
    devices.value = devices.value.filter(item => item.id !== id)
  }

  return {
    devices,
    state,
    load,
    refresh,
    startPolling,
    stopPolling,
    confirmPairing,
    rename,
    revoke,
  }
}
