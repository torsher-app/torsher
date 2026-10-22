import type {
  EngineSupervisor,
  EngineSupervisorOptions,
} from './supervisor.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { setEngineDown, setEngineReady } from './client.ts'
import { engineBinaryPath } from './binary.ts'
import { createEngineSupervisor } from './supervisor.ts'

export * from './client.ts'

/**
 * HTTP API движка — только на loopback: наружу стрим идёт через прокси ядра
 * с авторизацией. Список раздач и состояние кусков движок хранит в каталоге
 * данных, поэтому после перезапуска раздачи на месте.
 */
export function engineArgs(apiPort: number) {
  return [
    '--listen',
    `127.0.0.1:${apiPort}`,
    '--downloads',
    config.downloadsPath,
    '--data',
    join(config.dataDir, 'engine', 'state'),
    '--peer-port',
    String(config.enginePeerPort),
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

/** Перезапуск движка из панели; `false` — движок не запущен или уже перезапускается */
export function restartEngine() {
  return supervisor?.restart() ?? false
}
