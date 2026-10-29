import type { OverviewResponse } from '@torsher/api-client'
import { get } from '@torsher/demo/router'
import { DEMO_VERSION } from '@torsher/demo/state'
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

// «Обзор» собирается из состояния разделов, поэтому действия в них сразу
// меняют счётчики и «Требует внимания». Порядок причин — как на сервере
get<OverviewResponse>('/api/overview', () => ({
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
  downloads: downloadStats(),
  storage: storageStats(),
  sources: sourceStats(),
  devices: deviceStats(),
  playback: playbackSettings(),
  backups: backupStats(),
}))
