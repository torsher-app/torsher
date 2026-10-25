import type { PlayerSettings, Profile, ProfileList } from '@torsher/api-client'
import type { SessionStatus } from './lib/session.ts'
import { getErrorStatus } from '@torsher/api-client'
import { reactive, readonly } from 'vue'
import { api } from './api.ts'
import { applyLanguage } from './i18n.ts'
import { autoProfile } from './lib/session.ts'

const state = reactive<{ status: SessionStatus, profile: Profile | undefined }>(
  {
    status: 'unknown',
    profile: undefined,
  },
)

/** Подключение витрины и профиль зрителя; меняется только функциями ниже */
export const session = readonly(state)

function enter(profile: Profile) {
  state.profile = profile
  state.status = 'ready'
  applyLanguage(profile.language)
}

/** Профили сервера. `undefined` — витрина не подключена (401) */
export async function loadProfiles(): Promise<ProfileList | undefined> {
  try {
    return await api.profiles.getProfiles()
  }
  catch (err) {
    if (getErrorStatus(err) !== 401)
      throw err

    expireSession()

    return undefined
  }
}

/**
 * Профиль становится текущим на этом устройстве (у владельца — в браузере).
 * Ошибки PIN (403, 429) разбирает экран выбора.
 */
export async function chooseProfile(id: string, pin?: string) {
  enter(await api.profiles.postProfileSelect(id, pin ? { pin } : {}))
}

/**
 * Решает по списку профилей, нужен ли экран выбора: выбранный на устройстве
 * профиль сразу ведёт к просмотру, единственный без PIN выбирается сам.
 * `true` — выбирать не нужно.
 */
export async function settleSession(list: ProfileList) {
  const current = list.items.find(item => item.id === list.currentId)

  if (list.selected && current) {
    enter(current)
    return true
  }

  const auto = autoProfile(list)

  if (auto) {
    await chooseProfile(auto.id)
    return true
  }

  state.status = 'choosing'

  return false
}

/**
 * Спрашивает сервер, подключена ли витрина и выбран ли профиль. Ошибка
 * сервера ведёт на выбор профиля: там она видна и повторяется.
 */
export async function resolveSession() {
  try {
    const list = await loadProfiles()

    if (list)
      await settleSession(list)
  }
  catch {
    state.status = 'choosing'
  }
}

/**
 * Сервер больше не знает профиль этого устройства: снова «Кто смотрит?».
 * `false` — витрина ещё не смотрела, выбор и так впереди.
 */
export function requireProfile() {
  if (state.status !== 'ready')
    return false

  state.status = 'choosing'
  state.profile = undefined

  return true
}

/** Устройство отключили или сессия кончилась: витрина снова ждёт кода */
export function expireSession() {
  state.status = 'unpaired'
  state.profile = undefined
  applyLanguage(null)
}

/**
 * Настройки плеера текущего профиля: применяются сразу, а сервер запоминает их
 * для профиля. Сервер не принял — возвращаются прежние.
 */
export async function updatePlayerSettings(patch: Partial<PlayerSettings>) {
  const profile = state.profile

  if (!profile)
    return

  const previous = profile.player

  profile.player = { ...previous, ...patch }

  try {
    profile.player = await api.profiles.putCurrentPlayerSettings(patch)
  }
  catch {
    if (state.profile === profile)
      profile.player = previous
  }
}
