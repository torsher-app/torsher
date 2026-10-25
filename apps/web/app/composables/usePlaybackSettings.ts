import type { PlaybackSettings } from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

const settings = shallowRef<PlaybackSettings | null>(null)
const state = ref<LoadState>('idle')

async function load() {
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    settings.value = await withErrorMode('silent', () =>
      api.settings.getPlaybackSettings())
    state.value = 'ready'
  }
  catch {
    if (state.value === 'loading')
      state.value = 'error'
  }
}

/** `software` — перекодировать только процессором, даже если видеокарта есть */
async function setAccel(accel: PlaybackSettings['accel']) {
  settings.value = await api.settings.putPlaybackSettings({ accel })
}

/** Новые пробы видеокарты и замер процессора: занимают несколько секунд */
async function check() {
  settings.value = await api.settings.postPlaybackCheck()
}

/** Ускорение перекодирования на сервере: что найдено и чем кодировать */
export function usePlaybackSettings() {
  return { settings, state, load, setAccel, check }
}
