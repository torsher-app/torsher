import type { BackupItem } from './list.ts'
import { logFor } from '../logs/index.ts'
import { cleanupBackupTemp } from './cleanup.ts'
import { backupDirOf, isBackupDirAvailable } from './dir.ts'
import { toBackupError } from './errors.ts'
import { listBackupsIn } from './list.ts'
import { backupPaths, createBackupNow, currentDir } from './run.ts'
import { isDue, nextRunAt, slotFor } from './schedule.ts'
import { getBackupSettings } from './settings.ts'
import { getBackupState, runtime, updateBackupState } from './state.ts'

const TICK_MS = 60 * 1000

let startedAt = new Date()
let timer: ReturnType<typeof setInterval> | undefined
let ticking = false

export function lastScheduled(items: BackupItem[]) {
  return items.find(
    item => item.reason === 'scheduled' && item.dirKind === 'main',
  )?.createdAt
}

/** Минутный тик: доступность каталога и плановая копия, если пора */
export async function backupTick(now = new Date()) {
  if (ticking)
    return

  ticking = true

  try {
    const settings = getBackupSettings()
    const { defaultDir } = backupPaths()
    const dir = backupDirOf(settings, defaultDir)
    const available = await isBackupDirAvailable(dir)
    let state = getBackupState()

    if (state.dirAvailable !== available)
      state = updateBackupState({ dirAvailable: available })

    if (runtime.running)
      return

    const { items } = await listBackupsIn(dir.path, defaultDir)
    const input = {
      now,
      settings,
      state,
      startedAt,
      lastScheduledAt: lastScheduled(items),
    }

    if (!isDue(input))
      return

    const slot = slotFor(now, settings.time).toISOString()
    const previous
      = state.lastAttempt?.slot === slot ? state.lastAttempt.count : 0
    const attempt = { at: now.toISOString(), slot, count: previous + 1 }

    // Ответ панели и движок не ждут снимка: тик только запускает его
    void createBackupNow('scheduled').then(
      () => updateBackupState({ lastAttempt: attempt }),
      (err: unknown) => {
        const error = toBackupError(err)

        updateBackupState({
          lastAttempt: {
            ...attempt,
            error: { kind: error.kind, params: error.params },
          },
        })
      },
    )
  }
  catch (err) {
    logFor('backups').error({ err }, 'Backup schedule check failed')
  }
  finally {
    ticking = false
  }
}

export function startBackupScheduler() {
  startedAt = new Date()
  void cleanupBackupTemp({
    tmpDir: backupPaths().tmpDir,
    dirs: [currentDir().path],
  }).finally(() => void backupTick())
  timer = setInterval(() => void backupTick(), TICK_MS)
  timer.unref()
}

/** Остановка сервера обрывает идущий снимок: временные файлы удалит он сам */
export function stopBackupScheduler() {
  clearInterval(timer)
  timer = undefined
  runtime.running?.controller.abort()
}

/** Когда расписание снимет следующую копию — для панели */
export function nextScheduledAt(items: BackupItem[], now = new Date()) {
  return nextRunAt({
    now,
    settings: getBackupSettings(),
    state: getBackupState(),
    startedAt,
    lastScheduledAt: lastScheduled(items),
  })
}
