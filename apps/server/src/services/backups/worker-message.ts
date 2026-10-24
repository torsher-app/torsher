import type { WorkerResult } from './snapshot.worker.ts'

/**
 * Признак ответа рабочего потока. Под `node --watch` поток сначала шлёт
 * родителю служебные сообщения Node (`watch:require`, `watch:import`):
 * результат — только конверт с этим признаком.
 */
export const WORKER_RESULT_TYPE = 'backup-worker-result'

export interface WorkerResultMessage {
  type: typeof WORKER_RESULT_TYPE
  result: WorkerResult
}

/** Результат из сообщения потока; чужое сообщение — `undefined` */
export function workerResultOf(message: unknown): WorkerResult | undefined {
  if (
    typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === WORKER_RESULT_TYPE
  ) {
    return (message as WorkerResultMessage).result
  }

  return undefined
}
