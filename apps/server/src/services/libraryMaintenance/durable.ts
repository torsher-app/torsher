import type Database from 'better-sqlite3'
import { getDb } from '../../db/index.ts'

/**
 * WAL NORMAL недостаточен перед внешним эффектом. FULL действует только
 * в короткой синхронной транзакции; настройка соединения возвращается назад.
 */
export function durableSqlite<T>(sqlite: Database.Database, run: () => T): T {
  const previous = sqlite.pragma('synchronous', { simple: true }) as number
  if (sqlite.inTransaction) {
    if (previous < 2)
      throw new Error('maintenance_transaction_not_durable')
    return run()
  }
  sqlite.pragma('synchronous = FULL')
  try {
    return sqlite.transaction(run)()
  }
  finally {
    sqlite.pragma(`synchronous = ${previous}`)
  }
}
export function durableMaintenance<T>(run: () => T) {
  return durableSqlite(getDb().$client, run)
}
