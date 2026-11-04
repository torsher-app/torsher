import { durableMaintenance } from './durable.ts'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { fsyncFile, writeDurable } from '../backups/files.ts'
import { getSetting, setSetting } from '../settings/index.ts'

let reviewed: (() => void) | undefined
const markerName = 'maintenance-restore-hold'
/** Вне SQLite: переживает восстановление даже копии без maintenance-таблиц. */
export function writeMaintenanceRestoreHold(dataDir: string) {
  writeDurable(join(dataDir, markerName), 'restore-review-required\n')
  fsyncFile(dataDir)
}
export function initializeMaintenanceRestoreHold(restored: boolean) {
  if (restored || existsSync(join(config.dataDir, markerName))) {
    durableMaintenance(() => {
      setSetting('maintenanceRestoreHold', true)
      setSetting('maintenanceExecutionEnabled', false)
    })
  }
}
export function restoreHeld() {
  return (
    getSetting<boolean>('maintenanceRestoreHold') === true
    || existsSync(join(config.dataDir, markerName))
  )
}
export function clearMaintenanceRestoreHold() {
  // Подтверждение всегда оставляет исполнение выключенным.
  durableMaintenance(() => setSetting('maintenanceExecutionEnabled', false))
  const marker = join(config.dataDir, markerName)
  if (existsSync(marker)) {
    unlinkSync(marker)
    fsyncFile(config.dataDir)
  }
  durableMaintenance(() => setSetting('maintenanceRestoreHold', false))
  reviewed?.()
}

export function onMaintenanceReviewed(callback: () => void) {
  reviewed = callback
}
