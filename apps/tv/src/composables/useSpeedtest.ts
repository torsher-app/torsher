import type {
  InternetSpeedtestState,
  LocalSpeedtestState,
} from '@torsher/api-client'
import {
  createInternetSpeedtest,
  createLocalSpeedtest,
  getErrorStatus,
} from '@torsher/api-client'
import {
  computed,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  shallowRef,
  watch,
} from 'vue'
import { api } from '../api.ts'
import { session } from '../session.ts'

export function useSpeedtest(mode: 'local' | 'internet' = 'local') {
  const state = shallowRef<LocalSpeedtestState>({
    status: 'idle',
    error: null,
    result: null,
  })
  const internet = shallowRef<InternetSpeedtestState>({
    status: 'idle',
    error: null,
    result: null,
  })
  const local = createLocalSpeedtest({
    start: () => api.speedtest.postLocalSpeedtest({}),
    cancel: id => api.speedtest.deleteLocalSpeedtest(id),
    update: (value) => {
      state.value = value
    },
    errorStatus: getErrorStatus,
    demo: __DEMO__,
  })
  let controlGeneration = 0
  async function internetControl<T>(
    operation: () => Promise<T>,
    startGeneration?: number,
  ) {
    try {
      return await operation()
    }
    catch (error) {
      if (getErrorStatus(error) !== 401)
        throw error
      // A paired viewer on an old server remains valid; an owner's expired access cookie
      // instead refreshes through the ordinary viewer endpoint before the single retry.
      await api.profiles.getProfiles()
      if (
        startGeneration !== undefined
        && startGeneration !== controlGeneration
      ) {
        throw new Error('cancelled')
      }
      return operation()
    }
  }
  const server = createInternetSpeedtest({
    start: () =>
      internetControl(
        () => api.speedtest.postInternetSpeedtest({}),
        controlGeneration,
      ),
    status: id =>
      internetControl(() => api.speedtest.getInternetSpeedtest(id)),
    heartbeat: id =>
      internetControl(() =>
        api.speedtest.postInternetSpeedtestHeartbeat(id, {}),
      ),
    cancel: id =>
      internetControl(() => api.speedtest.deleteInternetSpeedtest(id)),
    update: (value) => {
      internet.value = value
    },
    // An older server can keep this optional endpoint owner-only without invalidating the paired TV.
    errorStatus: error =>
      getErrorStatus(error) === 401 ? 404 : getErrorStatus(error),
  })
  const runner = mode === 'internet' ? server : local
  const running = computed(() =>
    mode === 'internet'
      ? ['preparing', 'running'].includes(internet.value.status)
      : ['preparing', 'latency', 'download'].includes(state.value.status),
  )
  const stop = () => {
    if (running.value) {
      controlGeneration++
      runner.stop()
    }
  }
  const hidden = () => {
    if (document.hidden)
      stop()
  }
  watch(
    () => session.status,
    (value) => {
      if (value !== 'ready')
        stop()
    },
  )
  onMounted(() => document.addEventListener('visibilitychange', hidden))
  onDeactivated(stop)
  onBeforeUnmount(() => {
    stop()
    document.removeEventListener('visibilitychange', hidden)
  })
  const start = () => {
    controlGeneration++
    return runner.start()
  }
  return { state, internet, running, start, stop }
}
