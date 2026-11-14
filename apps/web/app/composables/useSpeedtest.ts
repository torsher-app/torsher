import type {
  InternetSpeedtestState,
  LocalSpeedtestState,
} from '@torsher/api-client'
import {
  createInternetSpeedtest,
  createLocalSpeedtest,
  getErrorStatus,
} from '@torsher/api-client'
import { api } from '~/services/api'

export function useSpeedtest() {
  const local = shallowRef<LocalSpeedtestState>({
    status: 'idle',
    error: null,
    result: null,
  })
  const serverState = shallowRef<InternetSpeedtestState>({
    status: 'idle',
    error: null,
    result: null,
  })
  const internet = computed(() => serverState.value.result)
  const internetState = computed(() => serverState.value.status)
  const internetError = computed(() => serverState.value.error)
  const localRunning = computed(() =>
    ['preparing', 'latency', 'download'].includes(local.value.status),
  )
  const internetRunning = computed(() =>
    ['preparing', 'running'].includes(internetState.value),
  )
  const silent = <T>(fn: () => Promise<T>) => withErrorMode('silent', fn)
  const runner = createLocalSpeedtest({
    start: () => silent(() => api.speedtest.postLocalSpeedtest({})),
    cancel: id => silent(() => api.speedtest.deleteLocalSpeedtest(id)),
    update: (value) => {
      local.value = value
    },
    errorStatus: getErrorStatus,
    demo: __DEMO__,
  })
  const internetRunner = createInternetSpeedtest({
    start: () => silent(() => api.speedtest.postInternetSpeedtest({})),
    status: id => silent(() => api.speedtest.getInternetSpeedtest(id)),
    heartbeat: id =>
      silent(() => api.speedtest.postInternetSpeedtestHeartbeat(id, {})),
    cancel: id => silent(() => api.speedtest.deleteInternetSpeedtest(id)),
    update: (value) => {
      serverState.value = value
    },
    errorStatus: getErrorStatus,
  })
  const startInternet = internetRunner.start
  const stopInternet = internetRunner.stop
  const stopLocal = () => {
    if (localRunning.value)
      runner.stop()
  }
  const stop = () => {
    stopLocal()
    if (internetRunning.value)
      stopInternet()
  }
  const hidden = () => {
    if (document.hidden)
      stop()
  }
  const { isAuthenticated } = useUser()
  watch(isAuthenticated, (value) => {
    if (!value)
      stop()
  })
  onMounted(() => document.addEventListener('visibilitychange', hidden))
  onDeactivated(stop)
  onBeforeUnmount(() => {
    stop()
    document.removeEventListener('visibilitychange', hidden)
  })
  return {
    local,
    internet,
    localRunning,
    internetRunning,
    internetState,
    internetError,
    startLocal: runner.start,
    stopLocal,
    startInternet,
    stopInternet,
  }
}
