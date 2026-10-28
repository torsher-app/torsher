import type {
  AppliedImport,
  ApplyProfileImportInput,
  ConfirmedPairing,
  ConfirmPairingInput,
  CreateProfileImportInput,
  CreateProfileInput,
  Device,
  DeviceList,
  HistoryEntry,
  ImportJob,
  ImportOverview,
  MatchImportRowInput,
  MessageResponse,
  OverviewResponse,
  Profile,
  ProfileHistory,
  ProfileList,
  SetProfilePinInput,
  UndoneImport,
  UnmatchedImportRow,
  UnmatchedImportRows,
  UpdateDeviceInput,
  UpdateProfileInput,
} from '@torsher/api-client'
import type { DemoDevice } from '../fixtures/people'
import {
  demoProfile,
  LIVED_PROFILES,
  livedDevices,
  livedHistory,
  livedUnmatched,
} from '../fixtures/people'
import { findTitle } from '../fixtures/titles'
import {
  del,
  DemoError,
  get,
  NO_CONTENT,
  patch,
  post,
  put,
  unavailable,
} from '../router'
import { ago, DAY, isFresh, nextId } from '../state'
import { ownerName, requireSession } from './auth'

let profiles: Profile[] = isFresh
  ? []
  : LIVED_PROFILES.map(item => ({ ...item }))
const history: Record<string, HistoryEntry[]> = isFresh ? {} : livedHistory()
let devices: DemoDevice[] = isFresh ? [] : livedDevices()

const profileNotFound = { message: 'Profile not found' }

/**
 * Профили по порядку; первый — профиль по умолчанию. Как и сервер, без
 * профилей создаёт его с именем владельца
 */
function listProfiles() {
  if (!profiles.length) {
    profiles = [
      demoProfile({
        id: nextId('profile'),
        name: ownerName(),
        color: 'violet',
      }),
    ]
  }

  return profiles
}

function profileOf(id: string) {
  const found = listProfiles().find(item => item.id === id)
  if (!found)
    throw new DemoError(404, profileNotFound)

  return found
}

function replaceProfile(updated: Profile) {
  profiles = profiles.map(item => (item.id === updated.id ? updated : item))

  return updated
}

get<ProfileList>('/api/profiles', () => {
  requireSession()

  const items = listProfiles()

  return { items, currentId: items[0]!.id, selected: true }
})

post<Profile, CreateProfileInput>('/api/profiles', ({ body }) => {
  requireSession()

  const { pin, ...values } = body
  const created = demoProfile({
    ...values,
    id: nextId('profile'),
    hasPin: Boolean(pin),
  })

  profiles = [...listProfiles(), created]

  return created
})

patch<Profile, UpdateProfileInput>('/api/profiles/:id', ({ params, body }) => {
  requireSession()

  return replaceProfile({ ...profileOf(params.id!), ...body })
})

del<MessageResponse>('/api/profiles/:id', ({ params, query }) => {
  requireSession()

  const id = params.id!
  const moveTo = query.get('moveTo')

  profileOf(id)

  if (moveTo && (moveTo === id || !profiles.some(item => item.id === moveTo)))
    throw new DemoError(400, { message: 'The target profile does not exist' })

  if (profiles.length === 1)
    throw new DemoError(409, { message: 'The last profile cannot be deleted' })

  if (moveTo) {
    const target = history[moveTo] ?? []
    const known = new Set(target.map(item => item.title.id))

    history[moveTo] = [
      ...target,
      ...(history[id] ?? []).filter(item => !known.has(item.title.id)),
    ].sort((a, b) => b.watchedAt.localeCompare(a.watchedAt))
  }

  delete history[id]
  profiles = profiles.filter(item => item.id !== id)
  // Устройство удалённого профиля переходит на профиль по умолчанию
  devices = devices.map(item =>
    item.profileId === id ? { ...item, profileId: profiles[0]!.id } : item,
  )

  return { message: 'Profile deleted' }
})

get<ProfileHistory>('/api/profiles/:id/history', ({ params, query }) => {
  requireSession()
  profileOf(params.id!)

  const items = history[params.id!] ?? []
  const offset = Number(query.get('offset') ?? 0)
  const limit = Number(query.get('limit') ?? 50)

  return { items: items.slice(offset, offset + limit), total: items.length }
})

put<Profile, SetProfilePinInput>('/api/profiles/:id/pin', ({ params }) => {
  requireSession()

  return replaceProfile({ ...profileOf(params.id!), hasPin: true })
})

del<Profile>('/api/profiles/:id/pin', ({ params }) => {
  requireSession()

  return replaceProfile({ ...profileOf(params.id!), hasPin: false })
})

// Импорт оценок: у Alex — прошлый импорт с несопоставленными строками.
// Новый файл без сервера честно не разобрать, поэтому задач импорта нет
interface LastImport {
  id: string
  appliedAt: string
  imported: number
  unchanged: number
  canUndo: boolean
}

const lastImports: Record<string, LastImport> = isFresh
  ? {}
  : {
      'profile-alex': {
        id: 'import-demo-1',
        appliedAt: ago(12 * DAY),
        imported: 214,
        unchanged: 12,
        canUndo: true,
      },
    }

const unmatched: Record<string, UnmatchedImportRow[]> = isFresh
  ? {}
  : { 'profile-alex': livedUnmatched() }

const importNotFound = { message: 'Import not found' }

function lastImportOf(profileId: string, importId: string) {
  const last = lastImports[profileId]
  if (!last || last.id !== importId)
    throw new DemoError(404, importNotFound)

  return last
}

function dropUnmatched(profileId: string, rowId: string) {
  const rows = unmatched[profileId] ?? []
  if (!rows.some(row => row.id === rowId))
    throw new DemoError(404, importNotFound)

  unmatched[profileId] = rows.filter(row => row.id !== rowId)
}

get<ImportOverview>('/api/profiles/:id/imports', ({ params }) => {
  requireSession()
  profileOf(params.id!)

  const last = lastImports[params.id!]
  const rows = unmatched[params.id!] ?? []

  return {
    job: null,
    last: last
      ? {
          id: last.id,
          appliedAt: last.appliedAt,
          summary: {
            imported: last.imported,
            unchanged: last.unchanged,
            unmatched: rows.length,
          },
          canUndo: last.canUndo,
        }
      : null,
    unmatched: rows.length,
  }
})

post<ImportJob, CreateProfileImportInput>('/api/profiles/:id/imports', () =>
  unavailable())

get<UnmatchedImportRows>(
  '/api/profiles/:id/imports/unmatched',
  ({ params, query }) => {
    requireSession()
    profileOf(params.id!)

    const rows = unmatched[params.id!] ?? []
    const offset = Number(query.get('offset') ?? 0)
    const limit = Number(query.get('limit') ?? 50)

    return { items: rows.slice(offset, offset + limit), total: rows.length }
  },
)

post<null, MatchImportRowInput>(
  '/api/profiles/:id/imports/unmatched/:rowId',
  ({ params, body }) => {
    requireSession()
    profileOf(params.id!)

    if (!findTitle(body.titleId))
      throw new DemoError(400, { message: 'Unknown title id' })

    dropUnmatched(params.id!, params.rowId!)

    return NO_CONTENT
  },
)

del<null>('/api/profiles/:id/imports/unmatched/:rowId', ({ params }) => {
  requireSession()
  profileOf(params.id!)
  dropUnmatched(params.id!, params.rowId!)

  return NO_CONTENT
})

get<ImportJob>('/api/profiles/:id/imports/:importId', () => {
  requireSession()

  throw new DemoError(404, importNotFound)
})

del<null>('/api/profiles/:id/imports/:importId', () => {
  requireSession()

  throw new DemoError(404, importNotFound)
})

post<AppliedImport, ApplyProfileImportInput>(
  '/api/profiles/:id/imports/:importId/apply',
  () => {
    requireSession()

    throw new DemoError(404, importNotFound)
  },
)

post<UndoneImport>('/api/profiles/:id/imports/:importId/undo', ({ params }) => {
  requireSession()
  profileOf(params.id!)

  const last = lastImportOf(params.id!, params.importId!)
  if (!last.canUndo)
    throw new DemoError(409, { message: 'Import cannot be undone' })

  last.canUndo = false

  return { restored: last.imported, kept: 0 }
})

// Устройства
const PAIRING_CODE = /^[A-HJ-NP-Z2-9]{6}$/

function toDevice(item: DemoDevice): Device {
  const { profileId, seenAgo, ...rest } = item
  const profile = profiles.find(entry => entry.id === profileId)

  return {
    ...rest,
    profile: profile
      ? { id: profile.id, name: profile.name, color: profile.color }
      : null,
    lastSeenAt: seenAgo === null ? null : ago(seenAgo),
  }
}

function deviceOf(id: string) {
  const found = devices.find(item => item.id === id)
  if (!found)
    throw new DemoError(404, { message: 'Device not found' })

  return found
}

/** Счётчики устройств для «Обзора» */
export function deviceStats(): OverviewResponse['devices'] {
  return {
    total: devices.length,
    watching: devices.filter(item => item.watching).length,
  }
}

// Любой код в формате кода с телевизора подключает новое устройство:
// телевизора, который показал бы код, в демо нет
post<ConfirmedPairing, ConfirmPairingInput>(
  '/api/devices/pairing/confirm',
  ({ body }) => {
    requireSession()

    const code = body.code.toUpperCase().replace(/[\s-]/g, '')
    if (!PAIRING_CODE.test(code))
      throw new DemoError(422, { message: 'Unknown code', kind: 'invalid' })

    devices = [
      ...devices,
      {
        id: nextId('device'),
        name: body.name,
        type: 'tv',
        profileId: listProfiles()[0]!.id,
        address: `192.168.1.${60 + devices.length}`,
        userAgent: null,
        createdAt: new Date().toISOString(),
        seenAgo: 0,
        watching: false,
      },
    ]

    return { name: body.name, type: 'tv' }
  },
)

get<DeviceList>('/api/devices', () => {
  requireSession()

  return { items: devices.map(toDevice) }
})

patch<Device, UpdateDeviceInput>('/api/devices/:id', ({ params, body }) => {
  requireSession()

  const updated = { ...deviceOf(params.id!), name: body.name }

  devices = devices.map(item => (item.id === updated.id ? updated : item))

  return toDevice(updated)
})

del<MessageResponse>('/api/devices/:id', ({ params }) => {
  requireSession()
  deviceOf(params.id!)

  devices = devices.filter(item => item.id !== params.id)

  return { message: 'Device revoked' }
})
