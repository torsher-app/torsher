import type { RestoreStatus } from '@torsher/api-client'
import { api } from '~/services/api'

type Phase = 'idle' | 'checking' | 'restarting' | 'stuck'

export type RestoreOutcome
  = | { kind: 'failed', restore: RestoreStatus }
    | { kind: 'finished', restore?: RestoreStatus, signedOut: boolean }
    | { kind: 'cancelled' }

const POLL_MS = 1000
// Сервер с подменой базы и миграциями обычно поднимается за секунды; дольше —
// скорее всего, контейнер без политики перезапуска
const STUCK_AFTER_MS = 90_000

const phase = ref<Phase>('idle')

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Уходящий на перезапуск сервер может принять соединение и не ответить:
// короткий таймаут, чтобы экран перезапуска появился сразу
const REQUEST_TIMEOUT_MS = 2000

/**
 * Голый `fetch` с коротким таймаутом: клиент API ждёт 10 с и повторяет
 * запрос, а на 401 после восстановления разлогинил бы панель. `down` —
 * сервер не ответил.
 */
async function restoreState(): Promise<
  { down: true } | { down: false, signedOut: boolean, restore?: RestoreStatus }
> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch('/api/backups/restore', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })

    if (response.status === 401)
      return { down: false, signedOut: true }

    if (!response.ok)
      return { down: true }

    const body = (await response.json()) as { restore?: RestoreStatus }

    return { down: false, signedOut: false, restore: body.restore }
  }
  catch {
    return { down: true }
  }
  finally {
    clearTimeout(timer)
  }
}

/**
 * Пока идёт проверка, 401 — истёкшая сессия: её обновляет любой запрос
 * клиента API, затем спрашиваем снова. `null` — сервер не ответил.
 */
async function checkingState() {
  let result = await restoreState()

  if (!result.down && result.signedOut) {
    await withErrorMode('silent', () => api.backups.getBackupRestore()).catch(
      () => {},
    )
    result = await restoreState()
  }

  return result.down || result.signedOut ? null : { restore: result.restore }
}

/**
 * Восстановление после запроса: ждём конца проверки копии, затем
 * перезапуска сервера. Новый процесс отвечает уже итогом (`done`/`failed`)
 * или 401: аккаунт из копии, а у этой вкладки его сессии нет. `signal` —
 * компонент, начавший восстановление, ушёл: опрос прекращается.
 */
async function follow(signal: AbortSignal): Promise<RestoreOutcome> {
  const cancelled = (): RestoreOutcome => {
    phase.value = 'idle'
    return { kind: 'cancelled' }
  }

  phase.value = 'checking'

  for (;;) {
    const checked = await checkingState()

    if (signal.aborted)
      return cancelled()

    const restore = checked?.restore

    if (restore?.state === 'failed') {
      phase.value = 'idle'
      return { kind: 'failed', restore }
    }

    // Проверка кончилась; сервер мог и перезапуститься между двумя опросами
    if (restore?.state !== 'checking')
      break

    await wait(POLL_MS)

    if (signal.aborted)
      return cancelled()
  }

  phase.value = 'restarting'

  const startedAt = Date.now()

  for (;;) {
    await wait(POLL_MS)

    if (Date.now() - startedAt > STUCK_AFTER_MS)
      phase.value = 'stuck'

    const result = await restoreState()

    if (signal.aborted)
      return cancelled()

    const state = result.down ? undefined : result.restore?.state

    if (result.down || state === 'pending' || state === 'checking')
      continue

    phase.value = 'idle'

    return {
      kind: 'finished',
      restore: result.restore,
      signedOut: result.signedOut,
    }
  }
}

/** Опрос живёт не дольше компонента, который его начал */
export function useRestoreFlow() {
  let controller: AbortController | undefined

  if (getCurrentInstance())
    onBeforeUnmount(() => controller?.abort())

  return {
    phase: readonly(phase),
    follow: () => {
      controller?.abort()
      controller = new AbortController()

      return follow(controller.signal)
    },
  }
}
