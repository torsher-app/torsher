import { randomBytes } from 'node:crypto'

// Capability живёт только в памяти ядра и окружении дочернего движка.
// Не передаётся в argv, публичный API, журнал или пользовательский конфиг.
export const engineMaintenanceToken = randomBytes(32).toString('hex')
export const engineMaintenanceHeaders = {
  'Content-Type': 'application/json',
  'X-Torsher-Maintenance-Token': engineMaintenanceToken,
}
