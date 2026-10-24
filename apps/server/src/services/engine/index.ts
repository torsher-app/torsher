import type {
  EngineSupervisor,
  EngineSupervisorOptions,
} from './supervisor.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../config.ts'
import {
  engineSettingsArgs,
  getTorrentSettings,
  rememberLaunched,
} from '../torrents/settings.ts'
import { setEngineDown, setEngineReady } from './client.ts'
import { engineBinaryPath } from './binary.ts'
import { createEngineSupervisor } from './supervisor.ts'

export * from './client.ts'

/**
 * HTTP API движка — только на loopback: наружу стрим идёт через прокси ядра
 * с авторизацией. Список раздач и состояние кусков движок хранит в каталоге
 * данных, поэтому после перезапуска раздачи на месте. Настройки торрента
 * читаются заново при каждом запуске: сеть меняется только так
 */
export function engineArgs(apiPort: number) {
  const settings = getTorrentSettings()

  rememberLaunched(settings)

  return [
    '--listen',
    `127.0.0.1:${apiPort}`,
    '--downloads',
    config.downloadsPath,
    '--data',
    join(config.dataDir, 'engine', 'state'),
    ...engineSettingsArgs(settings),
  ]
}

let supervisor: EngineSupervisor | undefined

export function createEngine(
  log: EngineSupervisorOptions['log'],
  onReady?: () => void,
) {
  mkdirSync(config.downloadsPath, { recursive: true })

  supervisor = createEngineSupervisor({
    binaryPath: engineBinaryPath(),
    args: engineArgs,
    log,
    onReady: (baseUrl) => {
      setEngineReady(baseUrl)
      onReady?.()
    },
    onDown: setEngineDown,
  })

  return supervisor
}

/**
 * Перезапуск движка из панели; `false` — движок не запущен или уже
 * перезапускается. `graceful` — ради настроек: движок успевает записать
 * отданное; без него — для зависшего движка
 */
export function restartEngine(options: { graceful?: boolean } = {}) {
  return supervisor?.restart(options) ?? false
}

/** Падения движка за последний час — для «Обзора» */
export function engineCrashCount() {
  return supervisor?.recentCrashes() ?? 0
}
