import type { OverviewResponse } from '@torsher/api-client'
import { loadRanges } from '~/lib/loadRanges'
import type { LoadRange } from '~/lib/loadRanges'
import { get } from '@torsher/demo/router'
import { DEMO_VERSION, isFresh } from '@torsher/demo/state'
import { overviewUpdate, serverStartedAt } from './auth'
import { backupAttention, backupStats } from './backups'
import { downloadStats } from './downloads'
import { followAttention } from './follow'
import { libraryAttention } from './library'
import { networkAttention } from './network'
import { deviceStats } from './people'
import { playbackSettings, settingsAttention } from './settings'
import { sourceAttention, sourceStats } from './sources'
import { storageAttention, storageStats } from './storage'

function demoLoad(range: LoadRange): OverviewResponse['load'] {
  const end = Math.floor(Date.now() / 5000) * 5000
  const { minutes, step } = loadRanges[range]
  const length = Math.max(
    1,
    1
    + Math.floor(
      Math.min(
        minutes * 60000,
        isFresh ? end - Date.parse(serverStartedAt) : Infinity,
      ) / step,
    ),
  )
  const history = Array.from({ length }, (_, i) => {
    const time = end - (length - 1 - i) * step
    const tick = time / 5000
    const busy = isFresh ? 0 : Math.max(0, Math.sin(tick / 12))
    return {
      time,
      cpuPeak: step > 5000 ? 0.15 + 1.5 * busy : undefined,
      cpuCores: 0.04 + busy + 0.03 * Math.cos(tick),
      memoryBytes: Math.round(
        (245 + busy * 55 + Math.sin(tick / 8) * 6) * 1024 ** 2,
      ),
      receiveBps: isFresh
        ? 0
        : Math.round((1.3 + Math.sin(tick / 5)) * 1024 ** 2),
      sendBps: isFresh
        ? 0
        : Math.round((0.6 + Math.cos(tick / 9) / 2) * 1024 ** 2),
    }
  })
  const sample = history[history.length - 1]!
  return {
    cpuCores: sample.cpuCores,
    memoryBytes: sample.memoryBytes,
    cpuCapacity: 4,
    memoryCacheBytes: Math.round(sample.memoryBytes * 0.65),
    memoryLimit: 2 * 1024 ** 3,
    receiveBps: sample.receiveBps,
    sendBps: sample.sendBps,
    history,
    historyRange: range,
    historyEnd: end,
    historyStepMs: step,
    playbackActive: false,
    analysis: isFresh ? null : { stage: 'credits', checked: 6, total: 10 },
    thumbnails: null,
  }
}

// «Обзор» собирается из состояния разделов, поэтому действия в них сразу
// меняют счётчики и «Требует внимания». Порядок причин — как на сервере
get<OverviewResponse>('/api/overview', ({ query }) => ({
  startedAt: serverStartedAt,
  version: DEMO_VERSION,
  attention: [
    ...storageAttention(),
    ...libraryAttention(),
    ...sourceAttention(),
    ...networkAttention(),
    ...settingsAttention(),
    ...backupAttention(),
    ...followAttention(),
  ],
  update: overviewUpdate(),
  load: demoLoad((query.get('range') || '15m') as LoadRange),
  downloads: downloadStats(),
  storage: storageStats(),
  sources: sourceStats(),
  devices: deviceStats(),
  playback: playbackSettings(),
  backups: backupStats(),
}))
