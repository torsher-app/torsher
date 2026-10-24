import type { SeedRule } from '../../db/schema.ts'
import type { EngineLiveSettings } from '../engine/client.ts'
import { randomInt } from 'node:crypto'
import { config } from '../../config.ts'
import { getSetting, setSetting } from '../settings/index.ts'

export const encryptionModes = ['prefer', 'require'] as const

export interface TorrentSettings {
  /** Байт/с, 0 — без лимита. Только загрузки: просмотр лимит не учитывает */
  downloadLimit: number
  /** Байт/с, 0 — без лимита; весь движок, включая просмотр */
  uploadLimit: number
  /** Сколько загрузок качаются одновременно, 0 — без очереди */
  activeDownloads: number
  /** Правило раздачи закреплённых загрузок без своего правила */
  seedRule: SeedRule
  /** Раздавать просмотренное из кэша */
  seedCache: boolean
  connsPerTorrent: number
  /** 0 — без общего предела */
  connsTotal: number
  peerPort: number
  upnp: boolean
  dht: boolean
  pex: boolean
  encryption: (typeof encryptionModes)[number]
}

export type TorrentSettingKey = keyof TorrentSettings

/** Их движок читает при запуске: меняются только перезапуском */
export const restartKeys = [
  'peerPort',
  'upnp',
  'dht',
  'pex',
  'encryption',
] as const satisfies TorrentSettingKey[]

const SETTINGS_KEY = 'torrent'
const PEER_PORT_KEY = 'torrent.generatedPeerPort'

// Динамический диапазон: порт не пересечётся со службами на известных портах
const PEER_PORT_MIN = 49152
const PEER_PORT_MAX = 65535

/**
 * Порт пиров по умолчанию: `ENGINE_PEER_PORT` или случайный, выбранный один
 * раз и сохранённый. Случайный при каждом старте не пробросить на роутере и
 * не опубликовать в Docker
 */
function defaultPeerPort() {
  if (config.enginePeerPort)
    return config.enginePeerPort

  const saved = getSetting<number>(PEER_PORT_KEY)

  if (saved)
    return saved

  const port = randomInt(PEER_PORT_MIN, PEER_PORT_MAX + 1)

  setSetting(PEER_PORT_KEY, port)
  return port
}

export function defaultTorrentSettings(): TorrentSettings {
  return {
    downloadLimit: 0,
    uploadLimit: 0,
    activeDownloads: 3,
    // Скачанное раздаётся, как в любом торрент-клиенте
    seedRule: { mode: 'always' },
    seedCache: true,
    connsPerTorrent: 50,
    connsTotal: 200,
    peerPort: defaultPeerPort(),
    upnp: false,
    dht: true,
    pex: true,
    encryption: 'prefer',
  }
}

function savedSettings() {
  return getSetting<Partial<TorrentSettings>>(SETTINGS_KEY) ?? {}
}

export function getTorrentSettings(): TorrentSettings {
  return { ...defaultTorrentSettings(), ...savedSettings() }
}

/** Поля, которые владелец сохранил сам; остальные — умолчания */
export function customTorrentKeys() {
  return Object.keys(savedSettings()) as TorrentSettingKey[]
}

/** Сохраняет только переданные поля: у каждой карточки панели — свои */
export function saveTorrentSettings(values: Partial<TorrentSettings>) {
  setSetting(SETTINGS_KEY, { ...savedSettings(), ...values })

  return getTorrentSettings()
}

export function liveSettingsOf(settings: TorrentSettings): EngineLiveSettings {
  return {
    downloadLimit: settings.downloadLimit,
    uploadLimit: settings.uploadLimit,
    connsPerTorrent: settings.connsPerTorrent,
    connsTotal: settings.connsTotal,
    activeDownloads: settings.activeDownloads,
  }
}

/** Флаги запуска движка из настроек */
export function engineSettingsArgs(settings: TorrentSettings) {
  return [
    '--peer-port',
    String(settings.peerPort),
    '--encryption',
    settings.encryption,
    '--download-limit',
    String(settings.downloadLimit),
    '--upload-limit',
    String(settings.uploadLimit),
    '--conns-per-torrent',
    String(settings.connsPerTorrent),
    '--conns-total',
    String(settings.connsTotal),
    '--active-downloads',
    String(settings.activeDownloads),
    ...(settings.upnp ? ['--upnp'] : []),
    ...(settings.dht ? [] : ['--no-dht']),
    ...(settings.pex ? [] : ['--no-pex']),
  ]
}

type RestartValues = Pick<TorrentSettings, (typeof restartKeys)[number]>

let launched: RestartValues | undefined

/** Движок запускается с этими настройками: отличие от сохранённых — повод перезапустить */
export function rememberLaunched(settings: TorrentSettings) {
  launched = Object.fromEntries(
    restartKeys.map(key => [key, settings[key]]),
  ) as RestartValues
}

/** Сохранённые, но ещё не действующие настройки; движок не запускался — ничего */
export function pendingRestartKeys(settings: TorrentSettings) {
  const running = launched

  if (!running)
    return []

  return restartKeys.filter(key => running[key] !== settings[key])
}

export function resetLaunched() {
  launched = undefined
}
