import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { maintenanceOperations } from '../../db/schema.ts'
import { getSetting } from '../settings/index.ts'

/** Без Go допустим только известный локальный журнал; неизвестный backup требует recovery. */
export async function libraryStartupWithoutEngine() {
  if (getSetting<boolean>('maintenanceExecutionEnabled') === true)
    return false
  const directory = join(config.dataDir, 'engine', 'state', 'maintenance')
  try {
    const files = await readdir(directory)
    const known = new Map(
      getDb()
        .select()
        .from(maintenanceOperations)
        .all()
        .map(op => [op.id, op]),
    )
    for (const file of files.filter(file => file.endsWith('.json'))) {
      const fence = JSON.parse(await readFile(join(directory, file), 'utf8'))
      const op = known.get(fence.id)
      if (
        !op
        || file !== `${op.id}.json`
        || fence.manifest?.infoHash !== op.manifest.infoHash
        || !Array.isArray(fence.manifest?.paths)
        || JSON.stringify(
          fence.manifest.paths.map((item: { path: string }) => item.path),
        ) !== JSON.stringify(op.manifest.paths.map(item => item.path))
      ) {
        return false
      }
    }
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

/**
 * Recovery выполняется до producers; owner review продолжает тот же старт,
 * не требует второго перезапуска и не запускает продолжение дважды.
 */
export function createMaintenanceStartup(deps: {
  ready: () => boolean
  held: () => boolean
  recover: () => Promise<void>
  resume: () => Promise<void>
  library?: () => Promise<void>
  safeWithoutEngine?: () => Promise<boolean>
}) {
  let generation = 0
  let recovered = 0
  let resumed = 0
  let queue = Promise.resolve()
  function enqueue(work: () => Promise<void>) {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  }
  async function resume() {
    const current = generation
    if (
      !current
      || current !== recovered
      || current === resumed
      || !deps.ready()
      || deps.held()
    ) {
      return
    }
    await deps.resume()
    if (current === generation && !deps.held())
      resumed = current
  }
  return {
    initialize() {
      return enqueue(async () => {
        if (!deps.held() && (await deps.safeWithoutEngine?.()))
          await deps.library?.()
      })
    },
    engineReady() {
      const current = ++generation
      return enqueue(async () => {
        await deps.recover()
        if (current !== generation)
          return
        recovered = current
        await resume()
      })
    },
    reviewed() {
      return enqueue(resume)
    },
  }
}
