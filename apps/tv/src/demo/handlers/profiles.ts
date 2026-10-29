import type {
  AboutResponse,
  Pairing,
  PairingStatus,
  PlayerSettings,
  Profile,
  ProfileList,
  SelectProfileInput,
  StartPairingInput,
  UpdatePlayerSettingsInput,
} from '@torsher/api-client'
import { DemoError, get, post, put, unavailable } from '@torsher/demo/router'
import { DEMO_VERSION } from '@torsher/demo/state'
import { currentProfile, device, PROFILES } from '../viewer.ts'

// Устройство уже подключено: экрана кода в демо нет
post<Pairing, StartPairingInput>('/api/devices/pairing', () => unavailable())
get<PairingStatus>('/api/devices/pairing/:secret', () => unavailable())

get<ProfileList>('/api/profiles', () => ({
  items: PROFILES,
  currentId: device.currentId,
  selected: device.selected,
}))

// PIN детского профиля — любые четыре цифры
post<Profile, SelectProfileInput>(
  '/api/profiles/:id/select',
  ({ params, body }) => {
    const profile = PROFILES.find(item => item.id === params.id)

    if (!profile)
      throw new DemoError(404, { message: 'Profile not found' })

    if (profile.hasPin && !/^\d{4}$/.test(body?.pin ?? ''))
      throw new DemoError(403, { message: 'Wrong PIN', kind: 'wrong_pin' })

    device.currentId = profile.id
    device.selected = true

    return profile
  },
)

put<PlayerSettings, UpdatePlayerSettingsInput>(
  '/api/profiles/current/player',
  ({ body }) => {
    const profile = currentProfile()

    profile.player = { ...profile.player, ...body }
    return profile.player
  },
)

get<AboutResponse>('/api/about', () => ({
  version: DEMO_VERSION,
  license: 'AGPL-3.0-only',
  sourceUrl: 'https://github.com/torsher-app/torsher',
  imdbAttribution: false,
}))
