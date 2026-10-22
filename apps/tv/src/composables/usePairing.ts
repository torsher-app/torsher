import type { PollStep } from '../lib/pairing.ts'
import { getErrorStatus } from '@torsher/api-client'
import { onBeforeUnmount, ref } from 'vue'
import { api } from '../api.ts'
import { POLL_BACKOFF_MS, POLL_MS, pollStep } from '../lib/pairing.ts'
import { platform } from '../platform/index.ts'

export type PairingPhase = 'loading' | 'code' | 'error'

/**
 * Подключение по коду: сервер выдаёт код и секрет, витрина опрашивает статус
 * по секрету, пока владелец не введёт код в панели. После подтверждения
 * ответ опроса ставит cookie устройства. Истёкший код меняется сам.
 */
export function usePairing(onApproved: () => void) {
  const phase = ref<PairingPhase>('loading')
  const code = ref<string>()

  let secret: string | undefined
  let timer = 0
  let stopped = false

  function later(run: () => void, ms: number) {
    clearTimeout(timer)
    timer = window.setTimeout(run, ms)
  }

  async function start() {
    clearTimeout(timer)
    secret = undefined

    try {
      const pairing = await api.devices.postDevicePairing(
        // В браузере тип определит сервер по User-Agent
        platform === 'tv' ? { type: 'tv' } : {},
      )

      if (stopped)
        return

      secret = pairing.secret
      code.value = pairing.code
      phase.value = 'code'
      later(poll, POLL_MS)
    }
    catch {
      if (stopped)
        return

      // Сервер вернётся — код появится без нажатия «Повторить»
      phase.value = 'error'
      later(start, POLL_BACKOFF_MS)
    }
  }

  async function poll() {
    if (!secret)
      return

    let step: PollStep

    try {
      step = pollStep(await api.devices.getDevicePairing(secret))
    }
    catch (err) {
      step = pollStep({ error: getErrorStatus(err) })
    }

    if (stopped)
      return

    if (step.kind === 'approved')
      onApproved()
    else if (step.kind === 'restart')
      void start()
    else later(poll, step.ms)
  }

  function retry() {
    phase.value = 'loading'
    void start()
  }

  void start()

  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
  })

  return { phase, code, retry, restart: start }
}
