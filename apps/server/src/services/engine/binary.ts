import { join } from 'node:path'
import process from 'node:process'
import { config } from '../../config.ts'

/** Исходники движка в монорепо: `engine:build` собирает их Go */
export const ENGINE_SOURCE_DIR = join(
  import.meta.dirname,
  '../../../../../engine',
)

const BINARY_NAME
  = process.platform === 'win32' ? 'torsher-engine.exe' : 'torsher-engine'

/** Куда `engine:build` кладёт бинарник в разработке */
export function builtEnginePath() {
  return join(config.dataDir, 'engine', BINARY_NAME)
}

export function engineBinaryPath() {
  return config.enginePath ?? builtEnginePath()
}
