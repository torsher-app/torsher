import {
  acquireMaintenanceLease,
  assertMaintenancePolicyChange,
  MaintenanceBusyError,
} from '../libraryMaintenance/admission.ts'
import { recordSeeding } from '../libraryMaintenance/provenance.ts'
import type { SeedRule, Torrent } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import type { TorrentSettings } from './settings.ts'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { EngineError, isEngineReady, setTorrentSeed } from '../engine/index.ts'
import { logFor } from '../logs/index.ts'
import { getTorrentSettings } from './settings.ts'

/**
 * Почему раздача больше не раздаёт: достигнут рейтинг или время, правило
 * «не раздавать», выключена раздача просмотренного
 */
export type SeedStop = 'ratio' | 'time' | 'never' | 'cache'

export interface SeedingState {
  /** Своё правило загрузки; null — как в настройках */
  rule: SeedRule | null
  /** Действующее правило закреплённой загрузки; у кэша — null */
  effective: SeedRule | null
  uploaded: number
  /** Отдано, делённое на размер выбранного; нечего делить — null */
  ratio: number | null
  stopped: SeedStop | null
  /** Раздавать ли, когда раздаче ничего не нужно */
  seed: boolean
}

type ObligationTorrent = Pick<
  Torrent,
  | 'isPrivate'
  | 'files'
  | 'seedObligations'
  | 'seededSeconds'
  | 'trackerErrorCode'
  | 'startAnnounceState'
>
type ObligationLive = Pick<
  EngineTorrentState,
  | 'isPrivate'
  | 'uploaded'
  | 'seededSeconds'
  | 'verifiedComplete'
  | 'leftZeroAccepted'
  | 'trackerErrorCode'
  | 'startAnnounceState'
>

export function evaluateSeedObligation(
  torrent: ObligationTorrent,
  live?: ObligationLive,
) {
  const isPrivate = torrent.isPrivate || live?.isPrivate === true
  if (!isPrivate)
    return null

  const requirements = torrent.seedObligations ?? []
  const unknown
    = requirements.length === 0 || requirements.some(rule => rule.unknown)
  const size
    = torrent.files?.reduce((total, file) => total + file.size, 0) ?? 0
  const ratio = live && size > 0 ? live.uploaded / size : null
  const seededSeconds = live
    ? (live.seededSeconds ?? 0)
    : torrent.seededSeconds
  const verifiedComplete = live?.verifiedComplete === true
  const leftZeroAccepted = live?.leftZeroAccepted === true
  const trackerErrorCode
    = live?.trackerErrorCode || (!live ? torrent.trackerErrorCode : null)
  const meetsThreshold = requirements.every((rule) => {
    const checks = []
    if (rule.ratio !== null)
      checks.push(ratio !== null && ratio >= rule.ratio)
    if (rule.minutes !== null)
      checks.push(seededSeconds >= rule.minutes * 60)
    return (
      checks.length > 0
      && (rule.mode === 'and' ? checks.every(Boolean) : checks.some(Boolean))
    )
  })
  const met
    = !unknown && verifiedComplete && leftZeroAccepted && meetsThreshold
  return {
    met,
    unknown,
    requirements,
    ratio,
    seededSeconds,
    verifiedComplete,
    leftZeroAccepted,
    trackerErrorCode,
    startAnnounceState: live
      ? (live.startAnnounceState ?? null)
      : torrent.startAnnounceState,
  }
}

export function isSeedObligationMet(
  torrent: Torrent,
  live?: EngineTorrentState,
) {
  return evaluateSeedObligation(torrent, live)?.met ?? true
}

function selectionDone(live: EngineTorrentState) {
  return live.bytesWanted === 0 || live.wantedCompleted >= live.bytesWanted
}

/**
 * Правило раздачи для одной раздачи. Пока выбор качается, движок отдаёт
 * всегда: правило говорит, что делать потом
 */
export function seedingOf(
  torrent: Torrent,
  live: EngineTorrentState | undefined,
  settings: TorrentSettings,
  now = Date.now(),
): SeedingState {
  const uploaded = live?.uploaded ?? 0
  const size = live ? live.bytesWanted || live.bytesCompleted : 0
  const ratio = size > 0 ? uploaded / size : null
  const base = { rule: torrent.seedRule, uploaded, ratio }

  if (!isSeedObligationMet(torrent, live)) {
    return {
      ...base,
      effective:
        torrent.retention === 'cache'
          ? null
          : (torrent.seedRule ?? settings.seedRule),
      stopped: null,
      seed: true,
    }
  }

  if (torrent.retention === 'cache') {
    return {
      ...base,
      effective: null,
      stopped: settings.seedCache ? null : 'cache',
      seed: settings.seedCache,
    }
  }

  const effective = torrent.seedRule ?? settings.seedRule
  let stopped: SeedStop | null = null

  if (effective.mode === 'never') {
    stopped = 'never'
  }
  else if (
    effective.mode === 'ratio'
    && ratio !== null
    && ratio >= (effective.ratio ?? 0)
  ) {
    stopped = 'ratio'
  }
  else if (
    effective.mode === 'time'
    && torrent.completedAt
    && now - torrent.completedAt.getTime() >= (effective.minutes ?? 0) * 60_000
  ) {
    stopped = 'time'
  }

  const seed = stopped === null

  // Недокачанное движок раздаёт в обмен на куски: остановки ещё не видно
  if (live && !selectionDone(live))
    stopped = null

  return { ...base, effective, stopped, seed }
}

// Что уже отправлено в движок: флаг шлём только при изменении. Движок хранит
// его в сессии, поэтому перезапуск движка карту не обнуляет
const sent = new Map<string, boolean>()

function setCompletedAt(id: string, completedAt: Date | null) {
  getDb()
    .update(torrents)
    .set({ completedAt })
    .where(eq(torrents.id, id))
    .run()
}

/**
 * Применяет правила раздачи ко всем раздачам движка: отмечает, когда
 * докачался выбор, и отправляет движку флаг раздачи. Зовётся раз в минуту,
 * после смены настроек и после смены правила загрузки
 */
export async function enforceSeeding(live: Map<string, EngineTorrentState>) {
  if (!isEngineReady())
    return

  const settings = getTorrentSettings()
  const rows = getDb().select().from(torrents).all()
  const now = Date.now()

  for (const row of rows) {
    let maintenanceRelease: () => void
    try {
      maintenanceRelease = acquireMaintenanceLease({
        torrentId: row.id,
        producer: true,
      })
    }
    catch (error) {
      if (error instanceof MaintenanceBusyError)
        continue
      throw error
    }
    try {
      const state = live.get(row.infoHash)

      if (state && row.isPrivate) {
        const progress = {
          verifiedComplete: state.verifiedComplete ?? false,
          startAnnounceState: state.startAnnounceState || null,
          leftZeroAccepted: state.leftZeroAccepted ?? false,
          seededSeconds: state.seededSeconds ?? 0,
          trackerErrorCode: state.trackerErrorCode || null,
        }
        if (
          Object.entries(progress).some(
            ([key, value]) => row[key as keyof typeof progress] !== value,
          )
        ) {
          getDb()
            .update(torrents)
            .set(progress)
            .where(eq(torrents.id, row.id))
            .run()
        }
      }

      if (!state || state.paused)
        continue

      const done
        = state.bytesWanted > 0 && state.wantedCompleted >= state.bytesWanted
      let torrent = row

      if (done && !row.completedAt) {
        torrent = { ...row, completedAt: new Date(now) }
        setCompletedAt(row.id, torrent.completedAt)
      }
      else if (!done && row.completedAt) {
        torrent = { ...row, completedAt: null }
        setCompletedAt(row.id, null)
      }

      recordSeeding(torrent, state)
      const { seed } = seedingOf(torrent, state, settings, now)

      if (sent.get(row.id) === seed)
        continue

      try {
        await setTorrentSeed(row.infoHash, seed)
        sent.set(row.id, seed)
      }
      catch (err) {
        // Раздача переезжает или пропала из движка: следующий проход повторит
        if (
          err instanceof EngineError
          && ['not_found', 'moving'].includes(err.kind)
        ) {
          continue
        }

        if (err instanceof EngineError && err.kind === 'unavailable')
          return

        logFor('engine').warn(
          { err, torrentId: row.id },
          'Seeding rule not applied',
        )
      }
    }
    finally {
      maintenanceRelease()
    }
  }
}

/** Своё правило раздачи у закреплённой загрузки; null — как в настройках */
export function setSeedRule(torrent: Torrent, rule: SeedRule | null) {
  assertMaintenancePolicyChange({ torrentId: torrent.id })

  return getDb()
    .update(torrents)
    .set({ seedRule: rule })
    .where(eq(torrents.id, torrent.id))
    .returning()
    .get()
}
