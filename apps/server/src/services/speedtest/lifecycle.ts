import type { speedtestReasons } from '../../dto/speedtest.ts'

export type StopReason = (typeof speedtestReasons)[number]
// One active measurement in this process; these two callers only stop it.
let stop: ((reason: StopReason, subject?: string) => void) | undefined
export function setActiveSpeedtestStop(next: typeof stop) {
  stop = next
}
export function stopSpeedtest(reason: StopReason, subject?: string) {
  stop?.(reason, subject)
}
