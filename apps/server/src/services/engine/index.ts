import type { EngineSupervisorOptions } from './supervisor.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { setEngineDown, setEngineReady } from './client.ts'
import { rqbitBinaryPath } from './release.ts'
import { createEngineSupervisor } from './supervisor.ts'

export * from './client.ts'
export { RQBIT_VERSION } from './release.ts'

/**
 * HTTP API движка — только на loopback: наружу стрим идёт через прокси ядра
 * с авторизацией. Сессию (список раздач) движок хранит в каталоге данных,
 * поэтому после перезапуска раздачи на месте.
 */
export function rqbitArgs(apiPort: number) {
  return [
    '--http-api-listen-addr',
    `127.0.0.1:${apiPort}`,
    'server',
    'start',
    '--persistence-location',
    join(config.dataDir, 'engine', 'session'),
    config.downloadsPath,
  ]
}

export function createEngine(
  log: EngineSupervisorOptions['log'],
  onReady?: () => void,
) {
  mkdirSync(config.downloadsPath, { recursive: true })

  return createEngineSupervisor({
    binaryPath: rqbitBinaryPath(),
    args: rqbitArgs,
    log,
    onReady: (baseUrl) => {
      setEngineReady(baseUrl)
      onReady?.()
    },
    onDown: setEngineDown,
  })
}
