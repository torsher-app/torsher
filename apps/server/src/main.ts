import type { LogLevel } from './services/logs/index.ts'
import process from 'node:process'
import packageJson from '../package.json' with { type: 'json' }
import { createApp } from './app.ts'
import { config } from './config.ts'
import { migrateDb } from './db/index.ts'
import { createEngine, isEngineReady } from './services/engine/index.ts'
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
import { applyHomeVideoFields } from './services/library/homeVideo.ts'
import { queueMatch, queueUnmatched } from './services/library/match.ts'
import { onFolderScanned, scanAllFolders } from './services/library/scan.ts'
import { watchFolder } from './services/library/watch.ts'
import { RequestLogController } from './services/logs/requestLog.ts'
import {
  cleanTranscodes,
  mediaAccel,
  stopAllSessions,
} from './services/media/index.ts'
import { startCheck } from './services/net/check.ts'
import { startImdbSchedule } from './services/ratings/imdb/index.ts'
import { purgeExpiredExternalIds } from './services/ratings/index.ts'
import { purgeExpiredAliases } from './services/sources/aliases.ts'
import { enforceStorage } from './services/storage/index.ts'
import { getSetting } from './services/settings/index.ts'
import { purgeExpiredMetaCache } from './services/tmdb/cache.ts'
import {
  clearStreamSelections,
  onTorrentReady,
  resumeResolving,
} from './services/torrents/index.ts'
import { createShutdown } from './shutdown.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// Кэш растёт, пока смотрят и качают: лимит и запас места проверяются раз в минуту
const STORAGE_CHECK_MS = 60 * 1000
// «Обзор» берёт недоступные хосты из последней проверки: без фоновой он
// после перезапуска ничего не знал бы о сети, пока владелец не открыл «Сеть»
const HOST_CHECK_MS = 30 * 60 * 1000

migrateDb()

function savedLogLevel() {
  const saved = getSetting<string>('logLevel')

  return LOG_LEVELS.find(level => level === saved)
}

const initialLevel: LogLevel = config.logLevel ?? savedLogLevel() ?? 'info'
const logger = createLogger({ level: initialLevel, logsDir: config.logsDir })

installLogger(logger)

// Срок хранения данных TMDB ограничен: чистим и при старте, и раз в сутки
function purgeTmdbData() {
  purgeExpiredMetaCache()
  purgeExpiredAliases()
  purgeExpiredExternalIds()
}

purgeTmdbData()
setInterval(purgeTmdbData, DAY_MS).unref()
await cleanTranscodes()

// Своя раскладка: строка библиотеки, проверка хардлинков и сверка с диском
managedFolder()
await checkLinkMode()

const FOLDER_SCAN_MS = 12 * 60 * 60 * 1000

function checkLibrary() {
  checkManagedFiles()
    .then(queueUnprobed)
    .catch(err => logFor('storage').error({ err }, 'Library check failed'))
}

checkLibrary()
setInterval(checkLibrary, DAY_MS).unref()

// Раздачи без тайтла (добавленные в панели) узнаются по имени: новые — когда
// пришёл список файлов, прежние — сейчас; узнанные ложатся в библиотеку
onTorrentReady((torrent) => {
  if (!torrent.titleId)
    void queueRecognition(torrent.id)
})
startRecognition(() => void syncLibrary())

// Подключённые папки: скан при старте и раз в 12 ч — страховка к
// наблюдателю; новые файлы «Фильмов и сериалов» идут на сопоставление
onFolderScanned((folder, library, result) => {
  if (library.kind === 'video')
    void queueMatch(folder.id, result.added)
  else applyHomeVideoFields([...result.added, ...result.changed])

  void watchFolder(folder, library)
})
void scanAllFolders().then(queueUnmatched)
setInterval(() => void scanAllFolders(), FOLDER_SCAN_MS).unref()

// Пробы видеокарты и замер процессора — в фоне: первому перекодированию они
// уже готовы, а прямой просмотр их не ждёт
mediaAccel().catch(err =>
  logFor('playback').warn({ err }, 'Acceleration check failed'),
)
startImdbSchedule()

const app = createApp(
  {
    // Плеер держит поток часами: при остановке его не дожидаемся
    forceCloseConnections: true,
    loggerInstance: logger,
    logController: new RequestLogController(),
  },
  config.clients,
)

// Заодно раскладывает докачанное в библиотеку: тот же список раздач движка
function checkStorage() {
  if (!isEngineReady())
    return

  enforceStorage()
    .catch(err => logFor('storage').error({ err }, 'Storage check failed'))
    .finally(syncLibrary)
}

// Раздачи, которые ждали метаданные до перезапуска, дожидаются их снова.
// Выбор, накопленный просмотром в прежних версиях, снимается до проверки
// места: иначе пауза из-за места считала бы его закачкой
const engine = createEngine(logFor('engine'), () => {
  resumeResolving().catch(err =>
    logFor('engine').error({ err }, 'Resolve failed'),
  )
  clearStreamSelections()
    .catch(err => logFor('engine').error({ err }, 'Selection cleanup failed'))
    .finally(checkStorage)
})

setInterval(checkStorage, STORAGE_CHECK_MS).unref()

function checkHosts() {
  try {
    startCheck()
  }
  catch (err) {
    logFor('network').error({ err }, 'Host check failed')
  }
}

// Движок — дочерний процесс: без остановки он пережил бы сервер и держал
// порт и сессию, а `node --watch` при перезапуске шлёт именно SIGTERM
const shutdown = createShutdown({
  steps: [
    async () => logFor('server').info('Server is stopping'),
    // ffmpeg перепаковки тоже дочерний: его сегменты после выхода не нужны
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

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.once('exit', () => engine.kill())

await app.listen({ port: config.port, host: config.host })

logFor('server').info(
  {
    version: packageJson.version,
    port: config.port,
    platform: `${process.platform}/${process.arch}`,
    logLevel: getLogLevel(),
  },
  'Server started',
)

void engine.start()
checkHosts()
setInterval(checkHosts, HOST_CHECK_MS).unref()
