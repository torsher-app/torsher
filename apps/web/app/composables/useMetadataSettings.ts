import type {
  ImdbDatasetStatus,
  MetadataKeyCheck,
  MetadataSettings,
} from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Загрузка выгрузки IMDb идёт в фоне: пока она идёт, состояние перечитывается
const IMDB_POLL_MS = 2000

const settings = shallowRef<MetadataSettings | null>(null)
const state = ref<LoadState>('idle')

let imdbTimer: ReturnType<typeof setTimeout> | undefined

async function load() {
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    settings.value = await withErrorMode('silent', () =>
      api.settings.getMetadataSettings())
    state.value = 'ready'
    applyImdb(settings.value.imdb)
  }
  catch {
    if (state.value === 'loading')
      state.value = 'error'
  }
}

/** `null` — вернуться к ключу приложения */
async function saveTmdbKey(tmdbKey: string | null) {
  const saved = await api.settings.putMetadataSettings({ tmdbKey })

  settings.value = saved

  return saved
}

/** Без ключа проверяется текущий ключ сервера; неудача — не ошибка запроса */
function checkTmdbKey(tmdbKey?: string): Promise<MetadataKeyCheck> {
  return api.settings.postMetadataCheck({ tmdbKey })
}

function applyImdb(imdb: ImdbDatasetStatus) {
  if (settings.value)
    settings.value = { ...settings.value, imdb }

  clearTimeout(imdbTimer)
  imdbTimer
    = imdb.state === 'updating' ? setTimeout(pollImdb, IMDB_POLL_MS) : undefined
}

async function pollImdb() {
  try {
    const fresh = await withErrorMode('silent', () =>
      api.settings.getMetadataSettings())

    applyImdb(fresh.imdb)
  }
  catch {
    imdbTimer = setTimeout(pollImdb, IMDB_POLL_MS)
  }
}

async function setImdbEnabled(enabled: boolean) {
  applyImdb(await api.settings.putImdbSettings({ enabled }))
}

async function refreshImdb() {
  applyImdb(await api.settings.postImdbRefresh())
}

/** Уход со страницы: опрос не нужен */
function stopImdbPolling() {
  clearTimeout(imdbTimer)
  imdbTimer = undefined
}

export function useMetadataSettings() {
  return {
    settings: computed(() => settings.value),
    state: readonly(state),
    load,
    saveTmdbKey,
    checkTmdbKey,
    setImdbEnabled,
    refreshImdb,
    stopImdbPolling,
  }
}
