import {
  startResourceMonitor,
  stopResourceMonitor,
} from './services/overview/monitor.ts'
import { startAnalysis, stopAnalysis } from './services/segments/index.ts'
import {
  createMaintenanceStartup,
  libraryStartupWithoutEngine,
} from './services/libraryMaintenance/startup.ts'
import {
  initializeMaintenanceRestoreHold,
  onMaintenanceReviewed,
  restoreHeld,
} from './services/libraryMaintenance/restore.ts'
import {
  recoverMaintenance,
  startMaintenanceScheduler,
  stopMaintenanceScheduler,
} from './services/libraryMaintenance/executor.ts'
import type { LogLevel } from './services/logs/index.ts'
import process from 'node:process'
import { createApp } from './app.ts'
import { checkStartupConfig, config } from './config.ts'
import type { MigrateReport } from './db/index.ts'
import { DowngradeError, migrateDb, PreUpdateBackupError } from './db/index.ts'
import {
  addRestoreWarningsNow,
  applyPendingRestoreNow,
  cleanupBackupTempNow,
  finalizeRestoreNow,
  startBackupScheduler,
  stopBackupScheduler,
} from './services/backups/index.ts'
import { createEngine, isEngineReady } from './services/engine/index.ts'
import {
  startFollowScheduler,
  stopFollowScheduler,
} from './services/follow/schedule.ts'
import {
  checkLinkMode,
  checkManagedFiles,
  managedFolder,
  queueRecognition,
  queueUnprobed,
  startRecognition,
  syncLibrary,
} from './services/library/index.ts'
import {
  closeLogFiles,
  createLogger,
  getLogLevel,
  installLogger,
  LOG_LEVELS,
  logFor,
} from './services/logs/index.ts'
import { setScrubDownloads } from './services/logs/scrub.ts'
import { applyHomeVideoFields } from './services/library/homeVideo.ts'
import { queueMatch, queueUnmatched } from './services/library/match.ts'
import { onFolderScanned, scanAllFolders } from './services/library/scan.ts'
import { cleanupOrphanThumbs } from './services/library/thumbs.ts'
import { watchFolder } from './services/library/watch.ts'
import { RequestLogController } from './services/logs/requestLog.ts'
import {
  cleanTranscodes,
  mediaAccel,
  stopAllSessions,
} from './services/media/index.ts'
import { startCheck } from './services/net/check.ts'
import {
  announceServerUpdated,
  announceUpdate,
  checkEnabledIndexers,
  purgeOldNotifications,
  startNotificationMonitor,
} from './services/notifications/schedule.ts'
import { startImdbSchedule } from './services/ratings/imdb/index.ts'
import { purgeExpiredExternalIds } from './services/ratings/index.ts'
import { purgeExpiredAliases } from './services/sources/aliases.ts'
import { knownDownloadDirs } from './services/storage/folders.ts'
import { enforceStorage } from './services/storage/index.ts'
import { resumeMoves } from './services/storage/move.ts'
import { onStoragePathsChanged } from './services/storage/paths.ts'
import { getSetting } from './services/settings/index.ts'
import { purgeExpiredMetaCache } from './services/tmdb/cache.ts'
import {
  onUpdateFound,
  recordServerVersion,
  startUpdateSchedule,
} from './services/updates/index.ts'
import {
  clearStreamSelections,
  liveTorrents,
  onTorrentReady,
  reconcileEngineStorage,
  resumeResolving,
} from './services/torrents/index.ts'
import { enforceSeeding } from './services/torrents/seeding.ts'
import { purgeImports } from './services/transfer/imports.ts'
import { applyPendingDecisions } from './services/transfer/libraryMatches.ts'
import { onRestartRequested } from './services/lifecycle.ts'
import { reconcileTorrentsAfterRestore } from './services/torrents/reconcile.ts'
import { createShutdown } from './shutdown.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// Кэш растёт, пока смотрят и качают: лимит и запас места проверяются раз в минуту
const STORAGE_CHECK_MS = 60 * 1000
// «Обзор» берёт недоступные хосты из последней проверки: без фоновой он
// после перезапуска ничего не знал бы о сети, пока владелец не открыл «Сеть»
const HOST_CHECK_MS = 30 * 60 * 1000

try {
  checkStartupConfig()
}
catch (err) {
  process.stderr.write(`${(err as Error).message}\n`)
  process.exit(1)
}

// До любого обращения к базе и ключу секретов: восстановление подменяет их
await cleanupBackupTempNow()

const restoreResult = await applyPendingRestoreNow()
let migrateReport: MigrateReport

try {
  migrateReport = await migrateDb()
}
catch (err) {
  // Даунгрейд или копия перед миграциями не удалась: база не тронута,
  // владелец видит причину в журнале контейнера
  if (err instanceof DowngradeError || err instanceof PreUpdateBackupError) {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  }

  throw err
}

initializeMaintenanceRestoreHold(restoreResult.applied)

function savedLogLevel() {
  const saved = getSetting<string>('logLevel')

  return LOG_LEVELS.find(level => level === saved)
}

const initialLevel: LogLevel = config.logLevel ?? savedLogLevel() ?? 'info'
const logger = createLogger({ level: initialLevel, logsDir: config.logsDir })

installLogger(logger)

// Восстановление и копия перед миграциями прошли до логгера: пишем их итог сейчас
if (restoreResult.applied) {
  logFor('backups').info(
    { backup: restoreResult.backup, warnings: restoreResult.warnings },
    'Database restored from a backup',
  )
}
else if ('failed' in restoreResult) {
  logFor('backups').error(
    {
      backup: restoreResult.backup,
      reason: restoreResult.reason,
      err: restoreResult.error,
    },
    'Restore failed, the previous database was put back',
  )
}

if (migrateReport.backup) {
  logFor('backups').info(migrateReport.backup, 'Backup created before update')
}
else if (migrateReport.skippedBackup) {
  logFor('backups').warn(
    migrateReport.skippedBackup,
    'Database updated without a backup: TORSHER_SKIP_PRE_UPDATE_BACKUP is set',
  )
}

// Сервер стартовал с новой версией — в центре уведомлений «Обновлено до X»
const previousVersion = recordServerVersion()

if (previousVersion)
  announceServerUpdated(previousVersion, config.version)

// Срок хранения данных TMDB ограничен: чистим и при старте, и раз в сутки.
// Заодно — старые записи центра уведомлений
function purgeTmdbData() {
  purgeExpiredMetaCache()
  purgeExpiredAliases()
  purgeExpiredExternalIds()
  purgeOldNotifications()
}

purgeTmdbData()
setInterval(purgeTmdbData, DAY_MS).unref()
purgeImports()
setInterval(purgeImports, DAY_MS).unref()
// Файловые producers запускаются после recovery barrier.

// Своя раскладка: строка библиотеки, проверка хардлинков и сверка с диском
// managedFolder/checkLinkMode также выполняются после сверки.

// Перенос папок, прерванный остановкой, продолжается с того же места. Не по
// готовности движка: перенос библиотеки его не ждёт, загрузки ждут сами
// Запускается после восстановления maintenance fence в startLibraryProducers().

// Каталоги загрузок из панели и прежние каталоги раздач прячутся в журнале,
// как каталог окружения
function refreshScrub() {
  setScrubDownloads(knownDownloadDirs())
}

refreshScrub()
onStoragePathsChanged(refreshScrub)

let producersStarted = false
const FOLDER_SCAN_MS = 12 * 60 * 60 * 1000

function checkLibrary() {
  checkManagedFiles()
    .then(queueUnprobed)
    .catch(err => logFor('storage').error({ err }, 'Library check failed'))
}

setInterval(() => {
  if (!restoreHeld() && producersStarted)
    checkLibrary()
}, DAY_MS).unref()

// Раздачи без тайтла (добавленные в панели) узнаются по имени: новые — когда
// пришёл список файлов, прежние — сейчас; узнанные ложатся в библиотеку
onTorrentReady((torrent) => {
  if (!torrent.titleId)
    void queueRecognition(torrent.id)
})
// Recognition запускается за recovery barrier.

// Подключённые папки: скан при старте и раз в 12 ч — страховка к
// наблюдателю; новые файлы «Фильмов и сериалов» идут на сопоставление,
// кроме тех, о которых владелец уже решил на прежнем сервере (импорт данных)
onFolderScanned((folder, library, result) => {
  if (library.kind === 'video') {
    void queueMatch(folder.id, applyPendingDecisions(folder.id, result.added))
  }
  else {
    applyHomeVideoFields([...result.added, ...result.changed])
    applyPendingDecisions(folder.id, result.added)
  }

  void watchFolder(folder, library)
})
setInterval(() => {
  if (!restoreHeld() && producersStarted)
    void scanAllFolders()
}, FOLDER_SCAN_MS).unref()
async function startLibraryProducers() {
  if (producersStarted || restoreHeld())
    return
  producersStarted = true
  try {
    await cleanTranscodes()
    await cleanupOrphanThumbs()
    if (restoreHeld()) {
      producersStarted = false
      return
    }
    managedFolder()
    await checkLinkMode()
    if (restoreHeld()) {
      producersStarted = false
      return
    }
  }
  catch (error) {
    producersStarted = false
    throw error
  }
  startAnalysis()
  resumeMoves()
  checkLibrary()
  startRecognition(() => void syncLibrary())
  void scanAllFolders().then(queueUnmatched)
  startFollowScheduler()
}

// Пробы видеокарты и замер процессора — в фоне: первому перекодированию они
// уже готовы, а прямой просмотр их не ждёт
mediaAccel().catch(err =>
  logFor('playback').warn({ err }, 'Acceleration check failed'),
)
startImdbSchedule()
onUpdateFound(announceUpdate)
startUpdateSchedule()

const app = createApp(
  {
    // Плеер держит поток часами: при остановке его не дожидаемся
    forceCloseConnections: true,
    trustProxy: config.trustProxy,
    loggerInstance: logger,
    logController: new RequestLogController(),
  },
  config.clients,
)

// Заодно раскладывает докачанное в библиотеку и применяет правила раздачи:
// докачанный выбор начинает отсчёт «раздавать N часов»
function checkStorage() {
  if (!isEngineReady() || !producersStarted || restoreHeld())
    return

  // Повторяет отложенные изоляции/технические паузы после освобождения места.
  void reconcileEngineStorage().catch(err =>
    logFor('engine').error({ err }, 'Storage recovery check failed'),
  )
  resumeMoves()
  enforceStorage()
    .catch(err => logFor('storage').error({ err }, 'Storage check failed'))
    .finally(() => {
      void syncLibrary()
      liveTorrents()
        .then(enforceSeeding)
        .catch(err =>
          logFor('engine').error({ err }, 'Seeding check failed'),
        )
    })
}

// Раздачи, которые ждали метаданные до перезапуска, дожидаются их снова.
// Выбор, накопленный просмотром в прежних версиях, снимается до проверки
// места: иначе пауза из-за места считала бы его закачкой
let reconcilePending = restoreResult.applied

const maintenanceStartup = createMaintenanceStartup({
  ready: isEngineReady,
  held: restoreHeld,
  recover: recoverMaintenance,
  library: startLibraryProducers,
  safeWithoutEngine: libraryStartupWithoutEngine,
  resume: async () => {
    await reconcileEngineStorage()
    if (restoreHeld())
      return
    if (reconcilePending) {
      const result = await reconcileTorrentsAfterRestore()
      reconcilePending = false
      if (result.skipped) {
        addRestoreWarningsNow([{ kind: result.skipped }])
        logFor('backups').warn(
          'Torrents not reconciled after restore: downloads folder is unavailable',
        )
      }
      else {
        const { skipped: _skipped, ...counts } = result
        addRestoreWarningsNow([
          { kind: 'torrents_reconciled', params: counts },
        ])
        logFor('backups').info(counts, 'Torrents reconciled after restore')
      }
    }
    if (restoreHeld())
      return
    await startLibraryProducers()
    if (restoreHeld())
      return
    startMaintenanceScheduler()
    await resumeResolving().catch(err =>
      logFor('engine').error({ err }, 'Resolve failed'),
    )
    if (restoreHeld())
      return
    await clearStreamSelections().catch(err =>
      logFor('engine').error({ err }, 'Selection cleanup failed'),
    )
    checkStorage()
  },
})
function startupFailed() {
  logFor('storage').error(
    'Maintenance recovery unavailable; producers remain held',
  )
}
void maintenanceStartup.initialize().catch(startupFailed)
onMaintenanceReviewed(() => {
  void maintenanceStartup.reviewed().catch(startupFailed)
})
const engine = createEngine(logFor('engine'), () => {
  void maintenanceStartup.engineReady().catch(startupFailed)
})

setInterval(checkStorage, STORAGE_CHECK_MS).unref()

// Вместе с хостами — индексаторы: иначе «индексатор упал» было бы видно,
// только когда владелец сам нажмёт «Проверить»
function checkHosts() {
  try {
    startCheck()
  }
  catch (err) {
    logFor('network').error({ err }, 'Host check failed')
  }

  checkEnabledIndexers().catch(err =>
    logFor('sources').error({ err }, 'Indexer check failed'),
  )
}

// Движок — дочерний процесс: без остановки он пережил бы сервер и держал
// порт и сессию, а `node --watch` при перезапуске шлёт именно SIGTERM
const shutdown = createShutdown({
  steps: [
    async () => logFor('server').info('Server is stopping'),
    async () => stopBackupScheduler(),
    async () => stopFollowScheduler(),
    async () => stopMaintenanceScheduler(),
    // ffmpeg перепаковки тоже дочерний: его сегменты после выхода не нужны
    stopResourceMonitor,
    stopAnalysis,
    stopAllSessions,
    () => engine.stop(),
    () => app.close(),
    // Файл журнала пишется потоком: без этого последние записи потерялись бы
    closeLogFiles,
  ],
  kill: () => engine.kill(),
  exit: code => process.exit(code),
  onError: err => app.log.error({ err }, 'Shutdown failed'),
})

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())

// Восстановление ждёт перезапуска: выходим с кодом 3, Docker поднимает
// контейнер и при `unless-stopped`, и при `on-failure`
onRestartRequested((reason) => {
  logFor('server').info({ reason }, 'Server is restarting')
  shutdown(3)
})
process.once('exit', () => engine.kill())

await app.listen({ port: config.port, host: config.host })
startResourceMonitor()

logFor('server').info(
  {
    version: config.version,
    port: config.port,
    platform: `${process.platform}/${process.arch}`,
    logLevel: getLogLevel(),
  },
  'Server started',
)

if (restoreResult.applied)
  finalizeRestoreNow()

startBackupScheduler()
void engine.start()
startNotificationMonitor()
checkHosts()
setInterval(checkHosts, HOST_CHECK_MS).unref()
