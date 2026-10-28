import type {
  ApplyServerImportInput,
  AttentionItem,
  BackupDirCheck,
  BackupDirCheckBodyInput,
  BackupItem,
  BackupStatus,
  CreateExportInput,
  OverviewResponse,
  PreviewServerImportInput,
  RestoreStateResponse,
  UpdateBackupEncryptionInput,
  UpdateBackupSettingsInput,
} from '@torsher/api-client'
import {
  del,
  DemoError,
  get,
  NO_CONTENT,
  post,
  put,
  unavailable,
} from '../router'
import {
  ago,
  DAY,
  DEMO_VERSION,
  elapsedSeconds,
  GB,
  isFresh,
  MB,
} from '../state'

type Reason = BackupItem['reason']

const DEFAULT_DIR = '/data/backups'
// Ручная копия снимается в фоне: опрос панели видит её появление
const BACKUP_SECONDS = 3

const settings: BackupStatus['settings'] = {
  enabled: true,
  time: '04:00',
  keepDaily: 7,
  keepWeekly: 4,
  mode: isFresh ? 'key' : 'password',
  passwordSetAt: isFresh ? undefined : ago(4 * DAY + 2 * 3600),
}

// Своя папка на другом диске: копии переживут отказ диска с базой
let dir: Pick<BackupStatus['dir'], 'path' | 'source'> = isFresh
  ? { path: DEFAULT_DIR, source: 'default' }
  : { path: '/backups', source: 'panel' }

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0')
}

function backupName(
  createdAt: Date,
  reason: Reason,
  version: string,
  encrypted: boolean,
) {
  const stamp
    = `${createdAt.getUTCFullYear()}${pad(createdAt.getUTCMonth() + 1)}${pad(createdAt.getUTCDate())}`
      + `T${pad(createdAt.getUTCHours())}${pad(createdAt.getUTCMinutes())}${pad(createdAt.getUTCSeconds())}Z`

  return `torsher-backup-${stamp}-${reason}-v${version}.db.gz${encrypted ? '.enc' : ''}`
}

function makeItem(
  createdAt: Date,
  reason: Reason,
  size: number,
  version = DEMO_VERSION,
): BackupItem {
  const encrypted
    = settings.mode === 'password'
      && !!settings.passwordSetAt
      && createdAt.getTime() >= new Date(settings.passwordSetAt).getTime()

  return {
    name: backupName(createdAt, reason, version, encrypted),
    reason,
    createdAt: createdAt.toISOString(),
    version,
    size,
    encrypted,
    dirKind: 'main',
  }
}

/** Ближайший момент расписания в поясе браузера, `days` дней назад */
function scheduledAt(daysAgo: number) {
  const [hours, minutes] = settings.time.split(':').map(Number)
  const date = new Date()

  date.setHours(hours!, minutes!, 12, 0)

  if (date.getTime() > Date.now())
    date.setDate(date.getDate() - 1)

  date.setDate(date.getDate() - daysAgo)

  return date
}

function nextScheduled() {
  const next = scheduledAt(0)

  next.setDate(next.getDate() + 1)
  next.setSeconds(0)

  return next
}

function livedItems() {
  // База растёт понемногу: история просмотров, кэш каталога
  const daily = Array.from({ length: 6 }, (_, day) =>
    makeItem(scheduledAt(day), 'scheduled', 24.6 * MB - day * 0.18 * MB))
  // Версий до первой публичной нет, поэтому вместо копии перед обновлением —
  // ручная
  const manualAt = scheduledAt(3)

  manualAt.setHours(21, 7, 41)

  return [
    ...daily,
    makeItem(manualAt, 'manual', 23.9 * MB),
    makeItem(new Date(Date.now() - 9 * DAY), 'scheduled', 23.1 * MB),
  ]
}

const items: BackupItem[] = isFresh ? [] : livedItems()
let lastSuccessAt: string | undefined = items.find(
  item => item.reason !== 'uploaded',
)?.createdAt
let running: { startedAt: number, at: string } | undefined
let manual: BackupStatus['state']['manual']

function sortItems() {
  items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

sortItems()

/** Ручная копия кончилась, если время вышло: проверяется на каждом чтении */
function settle() {
  if (!running || elapsedSeconds() - running.startedAt < BACKUP_SECONDS)
    return

  const item = makeItem(
    new Date(),
    'manual',
    items[0] ? items[0].size + 0.05 * MB : 0.4 * MB,
  )

  items.push(item)
  sortItems()
  lastSuccessAt = item.createdAt
  manual = { at: item.createdAt }
  running = undefined
}

function status(): BackupStatus {
  settle()

  return {
    settings: { ...settings },
    dir: {
      ...dir,
      available: true,
      free: dir.path === DEFAULT_DIR ? 412 * GB : 2.7 * 1024 * GB,
      total: dir.path === DEFAULT_DIR ? 931 * GB : 3.6 * 1024 * GB,
      sameVolumeAsDatabase: dir.path.startsWith('/data'),
    },
    state: {
      running: running && { reason: 'manual', startedAt: running.at },
      lastSuccessAt,
      lastAttempt: lastSuccessAt ? { at: lastSuccessAt } : undefined,
      manual,
      nextAt: settings.enabled ? nextScheduled().toISOString() : undefined,
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    items: items.map(item => ({ ...item })),
  }
}

/** Плитка копий на «Обзоре» */
export function backupStats(): OverviewResponse['backups'] {
  const current = status()

  return {
    enabled: current.settings.enabled,
    lastSuccessAt: current.state.lastSuccessAt,
    failing: backupAttention().length > 0,
  }
}

/** Каталог доступен, плановые копии снимаются: в демо причин нет */
export function backupAttention(): AttentionItem[] {
  return []
}

function checkDir(path: string): BackupDirCheck {
  const free = path.startsWith('/data') ? 412 * GB : 2.7 * 1024 * GB
  const total = path.startsWith('/data') ? 931 * GB : 3.6 * 1024 * GB
  let problem: BackupDirCheck['problem'] = null

  if (!path.startsWith('/'))
    problem = 'not_absolute'
  else if (path.startsWith('/data/downloads'))
    problem = 'overlaps_storage'

  return {
    path,
    problem,
    free,
    total,
    sameVolumeAsDatabase: path.startsWith('/data'),
  }
}

// Точные пути раньше шаблонного `/api/backups/:name`
get<BackupStatus>('/api/backups', () => status())

post<BackupStatus>('/api/backups', () => {
  settle()
  running ??= { startedAt: elapsedSeconds(), at: ago(0) }

  return status()
})

put<BackupStatus, UpdateBackupSettingsInput>(
  '/api/backups/settings',
  ({ body }) => {
    if (body.dir) {
      const { problem } = checkDir(body.dir)

      if (problem) {
        throw new DemoError(422, {
          message: `Backup folder rejected: ${problem}`,
          kind: problem,
          field: 'dir',
        })
      }

      dir = { path: body.dir, source: 'panel' }
    }
    else if (body.dir === null) {
      dir = { path: DEFAULT_DIR, source: 'default' }
    }

    settings.enabled = body.enabled
    settings.time = body.time
    settings.keepDaily = body.keepDaily
    settings.keepWeekly = body.keepWeekly

    return status()
  },
)

put<BackupStatus, UpdateBackupEncryptionInput>(
  '/api/backups/encryption',
  ({ body }) => {
    settings.mode = body.mode
    settings.passwordSetAt = body.mode === 'password' ? ago(0) : undefined

    return status()
  },
)

post<BackupDirCheck, BackupDirCheckBodyInput>(
  '/api/backups/check',
  ({ body }) => checkDir(body.path),
)

// Восстановлений в демо не бывает: результата прошлого тоже нет
get<RestoreStateResponse>('/api/backups/restore', () => ({}))
del('/api/backups/restore', () => NO_CONTENT)

// Загрузка файла копии и восстановление перезапускают сервер: без него не показать
post('/api/backups/upload', () => unavailable())
post('/api/backups/restore', () => unavailable())
post('/api/backups/:name/restore', () => unavailable())

del('/api/backups/:name', ({ params }) => {
  const index = items.findIndex(item => item.name === params.name)

  if (index === -1)
    throw new DemoError(404, { message: 'Backup not found' })

  items.splice(index, 1)

  return NO_CONTENT
})

// --- Перенос данных ---

/**
 * Экспорт собирается в браузере и сразу скачивается: файл честный, но
 * сервера нет, поэтому в нём только профили и каналы без секретов
 */
// Экспорт — файл с данными сервера: выдуманный файл выдавал бы себя за
// настоящий
post<never, CreateExportInput>('/api/transfer/export', () => unavailable())

// Импорт разбирает файл, выбранный человеком: без сервера его не прочесть
post<never, PreviewServerImportInput>('/api/transfer/import/preview', () =>
  unavailable())
post<never, ApplyServerImportInput>('/api/transfer/import/apply', () =>
  unavailable())
