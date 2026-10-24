import type {
  InspectJob,
  SnapshotFacts,
  SnapshotJob,
  WorkerJob,
  WorkerResult,
} from './snapshot.worker.ts'
import { Worker } from 'node:worker_threads'
import { BackupError, toBackupError } from './errors.ts'

const WORKER_URL = new URL('./snapshot.worker.ts', import.meta.url)

/**
 * Задание в рабочем потоке. Отмена (`signal`) обрывает поток; ответ — только
 * когда поток остановлен, иначе он дописал бы файл после того, как
 * вызывающий его удалил.
 */
function runWorker(job: WorkerJob, signal?: AbortSignal) {
  return new Promise<WorkerResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BackupError('io', { code: 'ABORTED' }))
      return
    }

    const worker = new Worker(WORKER_URL, { workerData: job })
    let settled = false

    function settle(result: WorkerResult | undefined, err?: unknown) {
      if (settled)
        return

      settled = true
      signal?.removeEventListener('abort', abort)

      if (err)
        reject(err)
      else resolve(result!)
    }

    function abort() {
      void worker
        .terminate()
        .finally(() =>
          settle(undefined, new BackupError('io', { code: 'ABORTED' })),
        )
    }

    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (result: WorkerResult) => settle(result))
    worker.once('error', err => settle(undefined, toBackupError(err)))
    worker.once('exit', (code) => {
      if (!signal?.aborted) {
        settle(
          undefined,
          new BackupError('io', { code: `WORKER_EXIT_${code}` }),
        )
      }
    })
  })
}

function failureOf(result: Extract<WorkerResult, { ok: false }>) {
  if (result.kind === 'integrity')
    return new BackupError('integrity', { detail: result.message })

  if (result.kind === 'not_sqlite')
    return new BackupError('not_torsher')

  if (result.kind === 'corrupt')
    return new BackupError('corrupt')

  return toBackupError(
    Object.assign(new Error(result.message), { code: result.code }),
  )
}

export async function takeSnapshot(
  job: Omit<SnapshotJob, 'mode'>,
  signal?: AbortSignal,
) {
  const result = await runWorker({ ...job, mode: 'snapshot' }, signal)

  // Своя база не открывается как SQLite — значит, она испорчена
  if (!result.ok && (result.kind === 'not_sqlite' || result.kind === 'corrupt'))
    throw new BackupError('integrity', { detail: result.message })

  if (!result.ok)
    throw failureOf(result)
}

/** Проверка файла копии: целостность, таблицы, миграции, манифест */
export async function inspectInWorker(
  job: Omit<InspectJob, 'mode'>,
): Promise<SnapshotFacts> {
  const result = await runWorker({ ...job, mode: 'inspect' })

  if (!result.ok)
    throw failureOf(result)

  return result.facts!
}
