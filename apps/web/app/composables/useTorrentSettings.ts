import type {
  TorrentSettings,
  UpdateTorrentSettings,
} from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Движок поднимается за секунды; дольше — восстановление сотен раздач
const RESTART_POLL_MS = 1000
const RESTART_POLL_LIMIT = 60

const settings = shallowRef<TorrentSettings | null>(null)
const state = ref<LoadState>('idle')

async function load() {
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    settings.value = await withErrorMode('silent', () =>
      api.settings.getTorrentSettings())
    state.value = 'ready'
  }
  catch {
    if (state.value === 'loading')
      state.value = 'error'
  }
}

/** Каждая карточка сохраняет только свои поля; ответ — настройки целиком */
async function save(values: UpdateTorrentSettings) {
  settings.value = await api.settings.putTorrentSettings(values)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Мягкий перезапуск движка ради сетевых настроек. Сервер отвечает сразу, а
 * отложенные изменения уходят из ответа, когда движок запустится с ними:
 * до этого опрашиваем, чтобы плашка перезапуска пропала сама
 */
async function restart() {
  await api.settings.postTorrentRestart()
  void waitForRestart()
}

async function waitForRestart() {
  for (let attempt = 0; attempt < RESTART_POLL_LIMIT; attempt++) {
    await sleep(RESTART_POLL_MS)

    try {
      const next = await withErrorMode('silent', () =>
        api.settings.getTorrentSettings())

      settings.value = next

      if (next.pendingRestart.length === 0)
        return
    }
    catch {}
  }
}

/** Настройки торрент-движка: скорость, очередь, раздача, сеть */
export function useTorrentSettings() {
  return { settings, state, load, save, restart }
}
