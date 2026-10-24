import type { AttentionItem } from '../../dto/overview.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import type { AccelState } from '../media/index.ts'
import { performance } from 'node:perf_hooks'
import { config } from '../../config.ts'
import { isWatching, listDevices } from '../devices/index.ts'
import { engineCrashCount, engineState } from '../engine/index.ts'
import { listIndexers } from '../indexers/index.ts'
import { checkState } from '../net/check.ts'
import { currentLinkMode } from '../library/link.ts'
import { accelSnapshot, playbackSettingsOf } from '../media/index.ts'
import { isStreaming, storageSummary } from '../storage/index.ts'
import { tmdbKeyStatus } from '../tmdb/credentials.ts'
import { overviewUpdate } from '../updates/index.ts'
import {
  downloadStateOf,
  listTorrents,
  liveTorrents,
} from '../torrents/index.ts'
import { listLibraries } from '../library/folders.ts'
import { unmatchedGroups } from '../library/match.ts'

type Params = AttentionItem['params']

const ACTIVE_STATES = new Set(['downloading', 'stalled'])

/** Проблема с несколькими элементами: у одного в тексте его имя, иначе — число */
function counted(names: string[]): Params {
  return names.length === 1
    ? { count: 1, name: names[0] }
    : { count: names.length }
}

function engineAttention(): AttentionItem[] {
  const state = engineState()
  const crashes = engineCrashCount()
  const items: AttentionItem[] = []

  if (state !== 'ready') {
    items.push({
      kind: 'engine_down',
      // Запуск после старта или падения проходит сам за секунды
      severity: state === 'starting' ? 'warning' : 'error',
      section: 'downloads',
      params: { reason: state },
    })
  }

  // Движок поднимается сам, и падение иначе видно только в журнале
  if (crashes > 0) {
    items.push({
      kind: 'engine_crashed',
      severity: state === 'ready' ? 'warning' : 'error',
      section: 'logs',
      params: { count: crashes },
    })
  }

  return items
}

function indexerAttention(): AttentionItem[] {
  const enabled = listIndexers().filter(indexer => indexer.enabled)
  // Ошибка важнее пропажи из менеджера, как в списке «Источников»
  const failed = enabled.filter(
    indexer => indexer.checkStatus && indexer.checkStatus !== 'ok',
  )
  const missing = enabled.filter(
    indexer => indexer.missing && !failed.includes(indexer),
  )
  const items: AttentionItem[] = []

  if (failed.length) {
    items.push({
      kind: 'indexer_error',
      severity: 'error',
      section: 'sources',
      params: counted(failed.map(indexer => indexer.name)),
    })
  }

  if (missing.length) {
    items.push({
      kind: 'indexer_missing',
      severity: 'warning',
      section: 'sources',
      params: counted(missing.map(indexer => indexer.name)),
    })
  }

  return items
}

/** Последний результат проверки хостов: сама проверка здесь не запускается */
function networkAttention(): AttentionItem[] {
  const checked = checkState().hosts.filter(
    host => host.result && host.result.status !== 'ok',
  )
  // Подмена DNS — более точная причина той же недоступности
  const spoofed = checked.filter(host => host.result?.dnsSpoofed)
  const unreachable = checked.filter(host => !host.result?.dnsSpoofed)
  const hostOf = (id: string) => new URL(id).host
  const items: AttentionItem[] = []

  if (spoofed.length) {
    items.push({
      kind: 'dns_spoofing',
      severity: 'error',
      section: 'network',
      params: counted(spoofed.map(host => hostOf(host.id))),
    })
  }

  if (unreachable.length) {
    items.push({
      kind: 'host_unreachable',
      severity: 'error',
      section: 'network',
      params: counted(unreachable.map(host => hostOf(host.id))),
    })
  }

  return items
}

/**
 * Подключённые папки: недоступные (диск отвалился, нет прав), релизы без
 * тайтла и наблюдатель, который не встал
 */
function libraryAttention(): AttentionItem[] {
  const items: AttentionItem[] = []
  const folders = listLibraries()
    .filter(library => !library.managed)
    .flatMap(library => library.folders)
  const offline = folders.filter(
    folder => folder.status === 'offline' || folder.status === 'denied',
  )

  if (offline.length) {
    items.push({
      kind: 'library_offline',
      severity: 'error',
      section: 'library',
      params: counted(offline.map(folder => folder.path)),
    })
  }

  const unmatched = unmatchedGroups()

  if (unmatched.length) {
    items.push({
      kind: 'library_unmatched',
      severity: 'warning',
      section: 'library',
      params: counted(unmatched.map(group => group.name)),
    })
  }

  const watchers = folders.filter(folder => folder.watcher === 'failed')

  if (watchers.length) {
    items.push({
      kind: 'library_watcher',
      severity: 'warning',
      section: 'library',
      params: counted(watchers.map(folder => folder.path)),
    })
  }

  return items
}

function tmdbAttention(): AttentionItem[] {
  const status = tmdbKeyStatus()

  if (status === 'ok')
    return []

  return [
    {
      kind: 'tmdb_key_invalid',
      severity: 'error',
      section: 'metadata',
      params: { reason: status },
    },
  ]
}

/**
 * Видеокарта видна контейнеру, но ни одна не прошла пробное кодирование:
 * видео перекодирует процессор, медленнее и с меньшим потолком. Без
 * устройства пункта нет — у многих серверов видеокарты просто нет.
 */
function playbackAttention(state: AccelState | null): AttentionItem[] {
  if (!state || state.gpus.length > 0 || state.failed.length === 0)
    return []

  return [
    {
      kind: 'media_accel_failed',
      severity: 'warning',
      section: 'playback',
      params: {},
    },
  ]
}

function storageAttention(
  storage: { free: number, minFree: number, total: number },
  pausedNames: string[],
): AttentionItem[] {
  const items: AttentionItem[] = []

  if (storage.total > 0 && storage.free < storage.minFree) {
    items.push({
      kind: 'storage_low',
      severity: 'error',
      section: 'storage',
      params: { free: storage.free, minFree: storage.minFree },
    })
  }

  if (pausedNames.length) {
    items.push({
      kind: 'storage_paused',
      severity: 'warning',
      section: 'storage',
      params: counted(pausedNames),
    })
  }

  // Хардлинка нет: «Оставить» копирует файл, и раздача занимает место
  // в кэше, пока её не вытеснят
  if (currentLinkMode() === 'copy') {
    items.push({
      kind: 'library_copies',
      severity: 'warning',
      section: 'storage',
      params: {},
    })
  }

  return items
}

function downloadsOf(live: Map<string, EngineTorrentState>) {
  const rows = listTorrents()
  let active = 0
  let downloadSpeed = 0
  let uploadSpeed = 0
  const pausedForStorage: string[] = []

  for (const row of rows) {
    const state = live.get(row.infoHash)

    if (!state)
      continue

    if (ACTIVE_STATES.has(downloadStateOf(state, isStreaming(row.id))))
      active++

    if (state.paused && row.pauseReason === 'storage')
      pausedForStorage.push(row.name)

    downloadSpeed += state.downloadSpeed
    uploadSpeed += state.uploadSpeed
  }

  return {
    tile: { total: rows.length, active, downloadSpeed, uploadSpeed },
    pausedForStorage,
  }
}

async function collect(known?: Map<string, EngineTorrentState>) {
  const live = known ?? (await liveTorrents())
  const storage = await storageSummary(live)
  const downloads = downloadsOf(live)
  const accel = accelSnapshot()
  const attention = [
    ...engineAttention(),
    ...storageAttention(storage, downloads.pausedForStorage),
    ...libraryAttention(),
    ...indexerAttention(),
    ...networkAttention(),
    ...tmdbAttention(),
    ...playbackAttention(accel),
  ]

  // Сортировка стабильна: внутри уровня — порядок разделов выше
  attention.sort(
    (a, b) =>
      Number(a.severity === 'warning') - Number(b.severity === 'warning'),
  )

  return { storage, downloads, accel, attention }
}

/** «Требует внимания» без остального «Обзора»: по нему работают уведомления */
export async function serverAttention(live?: Map<string, EngineTorrentState>) {
  return (await collect(live)).attention
}

/**
 * Состояние сервера одним ответом: из того, что сервисы уже знают, без
 * новых запросов наружу. Без движка цифры загрузок — нули, том — всё равно.
 */
export async function getOverview() {
  const { storage, downloads, accel, attention } = await collect()
  const enabled = listIndexers().filter(indexer => indexer.enabled)
  const devices = listDevices()

  return {
    // Время старта процесса, а не модуля: модуль грузится позже
    startedAt: new Date(performance.timeOrigin).toISOString(),
    version: config.version,
    attention,
    update: overviewUpdate(),
    downloads: downloads.tile,
    storage: {
      usedByCache: storage.cacheUsed,
      cacheLimit: storage.cacheLimit,
      free: storage.free,
      total: storage.total,
      minFree: storage.minFree,
    },
    sources: {
      ok: enabled.filter(
        indexer => indexer.checkStatus === 'ok' && !indexer.missing,
      ).length,
      total: enabled.length,
    },
    devices: {
      total: devices.length,
      watching: devices.filter(device => isWatching(device)).length,
    },
    playback: accel && playbackSettingsOf(accel),
  }
}
