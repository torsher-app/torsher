import type {
  EngineSupervisor,
  EngineSupervisorOptions,
} from './supervisor.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { anyMoving } from '../storage/moving.ts'
import {
  engineSettingsArgs,
  getTorrentSettings,
  rememberLaunched,
  torrentRestartSettingsOf,
} from '../torrents/settings.ts'
import {
  getEngineNetwork,
  setEngineDown,
  setEngineNetwork,
  setEngineReady,
} from './client.ts'
import { engineBinaryPath } from './binary.ts'
import { createEngineSupervisor } from './supervisor.ts'

export * from './client.ts'

let supervisor: EngineSupervisor | undefined
let appliedRestartSettings:
  ReturnType<typeof torrentRestartSettingsOf> | undefined

/**
 * HTTP API движка — только на loopback: наружу стрим идёт через прокси ядра
 * с авторизацией. Список раздач и состояние кусков движок хранит в каталоге
 * данных, поэтому после перезапуска раздачи на месте. Живые настройки
 * читаются заново при каждом запуске, сетевые применяются только вручную.
 */
export function engineArgs(apiPort: number) {
  const settings = { ...getTorrentSettings(), ...appliedRestartSettings }

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

export function createEngine(
  log: EngineSupervisorOptions['log'],
  onReady?: () => void,
) {
  mkdirSync(config.downloadsPath, { recursive: true })
  appliedRestartSettings = torrentRestartSettingsOf(getTorrentSettings())

  supervisor = createEngineSupervisor({
    binaryPath: engineBinaryPath(),
    args: engineArgs,
    log,
    onReady: (baseUrl) => {
      setEngineReady(baseUrl)
      onReady?.()
    },
    onDown: setEngineDown,
    network: {
      check: getEngineNetwork,
      publish: setEngineNetwork,
      restartAllowed: network =>
        network.bindInterface === appliedRestartSettings?.bindInterface
        && !anyMoving(),
    },
  })

  return supervisor
}

/**
 * Перезапуск движка из панели; `false` — движок не запущен или уже
 * перезапускается. `graceful` — ради настроек: движок успевает записать
 * отданное; без него — для зависшего движка
 */
export function restartEngine(
  options: { graceful?: boolean, applySettings?: boolean } = {},
) {
  const next
    = options.applySettings && torrentRestartSettingsOf(getTorrentSettings())

  if (!supervisor?.restart(options))
    return false

  if (next)
    appliedRestartSettings = next

  return true
}

/** Падения движка за последний час — для «Обзора» */
export function engineCrashCount() {
  return supervisor?.recentCrashes() ?? 0
}
