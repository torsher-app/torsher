import type { TorznabCaps } from '../services/torznab/caps.ts'
import { randomUUID } from 'node:crypto'
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text('name').notNull(),
  // Нормализуется до записи (utils/email), в базе всегда нижний регистр
  email: text('email').notNull().unique(),
  // Хеш пишется только через utils/password — схема ничего не хеширует сама
  passwordHash: text('password_hash').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isBanned: integer('is_banned', { mode: 'boolean' }).notNull().default(false),
  isDeleted: integer('is_deleted', { mode: 'boolean' })
    .notNull()
    .default(false),
  // Входит в токены сессии: смена пароля или email и сброс увеличивают её,
  // и все выданные раньше токены перестают приниматься
  sessionVersion: integer('session_version').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
})

export type User = typeof users.$inferSelect

// Ответы внешних источников метаданных как есть: маппинг в DTO меняется
// без сброса кэша. Протухшие записи отдают, когда источник недоступен, но не дольше
// предела хранения (services/tmdb/cache.ts): старше него запись удаляется
export const metaCache = sqliteTable(
  'meta_cache',
  {
    key: text('key').primaryKey(),
    json: text('json').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  table => [index('meta_cache_fetched_at_idx').on(table.fetchedAt)],
)

export const profileColors = [
  'violet',
  'green',
  'orange',
  'blue',
  'rose',
  'teal',
  'amber',
  'slate',
] as const
export const profileLanguages = ['ru_RU', 'en_US'] as const

// Профиль смотрящего: свой прогресс, язык витрины и ограничения. Профиль по
// умолчанию — первый по `position`, его получают сессия владельца и ТВ,
// на котором профиль ещё не выбран
export const profiles = sqliteTable('profiles', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text('name').notNull(),
  color: text('color', { enum: profileColors }).notNull(),
  // null — язык устройства
  language: text('language', { enum: profileLanguages }),
  // Хеш PIN — тем же argon2id, что и пароль (utils/password)
  pinHash: text('pin_hash'),
  // Возраст, с которого тайтлы скрываются на витрине; null — без ограничений
  ageLimit: integer('age_limit'),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type Profile = typeof profiles.$inferSelect

export const deviceTypes = ['tv', 'browser', 'other'] as const

export type DeviceType = (typeof deviceTypes)[number]

// Устройство, подключённое по коду. Токен — случайная строка в httpOnly cookie,
// в базе только её SHA-256; удаление строки отзывает токен
export const devices = sqliteTable('devices', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text('name').notNull(),
  type: text('type', { enum: deviceTypes }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  // null — профиль на устройстве ещё не выбран
  profileId: text('profile_id').references(() => profiles.id, {
    onDelete: 'set null',
  }),
  lastIp: text('last_ip'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  // Последний запрос потока: по нему панель показывает «Смотрит сейчас»
  lastStreamAt: integer('last_stream_at', { mode: 'timestamp_ms' }),
})

export type Device = typeof devices.$inferSelect

// `pending` — код на экране, `approved` — владелец подтвердил, устройство ещё
// не забрало токен, `claimed` — токен выдан, секрет больше не действует
export const pairingStates = ['pending', 'approved', 'claimed'] as const

// Подключение устройства по коду. Секрет знает только устройство (в базе —
// SHA-256), код вводит владелец в панели
export const devicePairings = sqliteTable(
  'device_pairings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    secretHash: text('secret_hash').notNull().unique(),
    code: text('code').notNull(),
    state: text('state', { enum: pairingStates }).notNull(),
    type: text('type', { enum: deviceTypes }).notNull(),
    // Имя, которое дал владелец при подтверждении
    name: text('name'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    approvedBy: text('approved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  table => [index('device_pairings_code_idx').on(table.code)],
)

export type DevicePairing = typeof devicePairings.$inferSelect

export const indexerManagerKinds = ['prowlarr', 'jackett'] as const

export type IndexerManagerKind = (typeof indexerManagerKinds)[number]

// Менеджер индексаторов, из которого импортированы Torznab-индексаторы.
// Ключ хранится только шифртекстом (services/secrets)
export const indexerManagers = sqliteTable(
  'indexer_managers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    kind: text('kind', { enum: indexerManagerKinds }).notNull(),
    url: text('url').notNull(),
    apiKey: text('api_key').notNull(),
    syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('indexer_managers_kind_url_idx').on(table.kind, table.url),
  ],
)

export type IndexerManager = typeof indexerManagers.$inferSelect

export const indexerCheckStatuses = [
  'ok',
  'auth',
  'timeout',
  'unreachable',
  'bad_response',
  'remote',
] as const

export type IndexerCheckStatus = (typeof indexerCheckStatuses)[number]

export const indexers = sqliteTable(
  'indexers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    // Адрес Torznab без завершающего `/api` (services/torznab)
    url: text('url').notNull(),
    // Шифртекст; null — индексатор без ключа
    apiKey: text('api_key'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    managerId: text('manager_id').references(() => indexerManagers.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    // Менеджер больше не отдаёт этот индексатор; молча не удаляем
    missing: integer('missing', { mode: 'boolean' }).notNull().default(false),
    // Разобранный ответ `t=caps` (TorznabCaps) как JSON
    caps: text('caps', { mode: 'json' }).$type<TorznabCaps>(),
    checkStatus: text('check_status', { enum: indexerCheckStatuses }),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('indexers_manager_external_idx').on(
      table.managerId,
      table.externalId,
    ),
  ],
)

export type Indexer = typeof indexers.$inferSelect

export const torrentSources = ['magnet', 'file'] as const
// `resolving` — ждём метаданные magnet от пиров, `failed` — не дождались
export const torrentStatuses = ['resolving', 'ready', 'failed'] as const
export const torrentErrors = ['timeout', 'rejected', 'failed'] as const
// `cache` — просмотренное, вытесняется по давности; `keep` — «Оставить»
export const torrentRetentions = ['cache', 'keep'] as const
// Кто поставил паузу: владелец или сервер, когда кончилось место
export const torrentPauseReasons = ['user', 'storage'] as const

export interface TorrentFileEntry {
  path: string
  size: number
  // Файл-выравнивание между файлами раздачи: в списке не показывается,
  // но держит индексы и смещения файлов такими же, как в движке
  padding: boolean
}

export const torrents = sqliteTable('torrents', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  infoHash: text('info_hash').notNull().unique(),
  name: text('name').notNull(),
  source: text('source', { enum: torrentSources }).notNull(),
  // magnet хранится, чтобы дождаться метаданных и после перезапуска сервера
  magnet: text('magnet'),
  // Сам `.torrent`: по нему раздача заново добавляется в движок, если тот её забыл
  torrentFile: blob('torrent_file', { mode: 'buffer' }),
  files: text('files', { mode: 'json' }).$type<TorrentFileEntry[]>(),
  pieceLength: integer('piece_length'),
  status: text('status', { enum: torrentStatuses }).notNull(),
  error: text('error', { enum: torrentErrors }),
  // Раздача добавлена в движок (её начинали смотреть): удалить её можно,
  // только когда движок доступен, иначе он продолжит её качать
  inEngine: integer('in_engine', { mode: 'boolean' }).notNull().default(false),
  // Каталожный ID тайтла (`tmdb:tv:1396`), если раздачу выбрали из карточки
  titleId: text('title_id'),
  retention: text('retention', { enum: torrentRetentions })
    .notNull()
    .default('cache'),
  // Файлы, которые качаются целиком; остальные — только то, что читает поток
  selectedFiles: text('selected_files', { mode: 'json' }).$type<number[]>(),
  pauseReason: text('pause_reason', { enum: torrentPauseReasons }),
  addedAt: integer('added_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastAccessAt: integer('last_access_at', { mode: 'timestamp_ms' }),
})

export type Torrent = typeof torrents.$inferSelect

// Политика хранения — одна строка (`id = 1`); нет строки — значения по
// умолчанию от размера тома
export const storagePolicy = sqliteTable('storage_policy', {
  id: integer('id').primaryKey(),
  cacheLimitBytes: integer('cache_limit_bytes').notNull(),
  minFreeBytes: integer('min_free_bytes').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

// Позиция просмотра файла раздачи у профиля
export const watchStates = sqliteTable(
  'watch_states',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    torrentId: text('torrent_id')
      .notNull()
      .references(() => torrents.id, { onDelete: 'cascade' }),
    fileIndex: integer('file_index').notNull(),
    position: real('position').notNull(),
    duration: real('duration'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    primaryKey({
      columns: [table.profileId, table.torrentId, table.fileIndex],
    }),
  ],
)

export type WatchState = typeof watchStates.$inferSelect

// `official`, `original`, `alternative` и `translit` собираются из TMDB и живут
// не дольше его данных; `tracker` и `user` — названия из раздач и от пользователя
export const titleAliasKinds = [
  'official',
  'original',
  'alternative',
  'translit',
  'tracker',
  'user',
] as const

export type TitleAliasKind = (typeof titleAliasKinds)[number]

// Названия тайтла, по которым ищутся раздачи. `title_id` — каталожный ID
// (`tmdb:tv:1396`), пока у тайтлов нет своей таблицы
export const titleAliases = sqliteTable(
  'title_aliases',
  {
    titleId: text('title_id').notNull(),
    value: text('value').notNull(),
    // Ключ `titleKey`: одинаковый у написаний кириллицей и транслитом
    normalized: text('normalized').notNull(),
    lang: text('lang'),
    kind: text('kind', { enum: titleAliasKinds }).notNull(),
    syncedAt: integer('synced_at', { mode: 'timestamp_ms' }).notNull(),
  },
  table => [
    primaryKey({ columns: [table.titleId, table.kind, table.value] }),
    index('title_aliases_normalized_idx').on(table.normalized),
    index('title_aliases_synced_at_idx').on(table.syncedAt),
  ],
)

export type TitleAlias = typeof titleAliases.$inferSelect

// Озвучка, закреплённая за сезоном (у фильма сезон 0): студия, а без неё — тип
export const titleVoices = sqliteTable(
  'title_voices',
  {
    titleId: text('title_id').notNull(),
    season: integer('season').notNull(),
    studio: text('studio'),
    type: text('type'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [primaryKey({ columns: [table.titleId, table.season] })],
)

// Позиция просмотра тайтла и серии (у фильма сезон и серия — 0): не зависит
// от раздачи, поэтому смена раздачи или озвучки прогресс не сбрасывает.
// У каждого профиля свой прогресс
export const titleProgress = sqliteTable(
  'title_progress',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    titleId: text('title_id').notNull(),
    season: integer('season').notNull(),
    episode: integer('episode').notNull(),
    position: real('position').notNull(),
    duration: real('duration'),
    // Чем смотрели в последний раз: по студии работает «как в прошлых сериях»
    torrentId: text('torrent_id').references(() => torrents.id, {
      onDelete: 'set null',
    }),
    fileIndex: integer('file_index'),
    voiceStudio: text('voice_studio'),
    voiceType: text('voice_type'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    primaryKey({
      columns: [table.profileId, table.titleId, table.season, table.episode],
    }),
    index('title_progress_updated_at_idx').on(
      table.profileId,
      table.titleId,
      table.updatedAt,
    ),
  ],
)

export type TitleProgress = typeof titleProgress.$inferSelect

// `socks5h` — имя хоста разрешает прокси; `http` — CONNECT по имени хоста
export const netRouteVias = ['direct', 'socks5h', 'http'] as const
// `system` — DNS ОС; остальное — встроенный DoH (`custom` — свой адрес)
export const netRouteDns = [
  'system',
  'quad9',
  'google',
  'cloudflare',
  'custom',
] as const

export type NetRouteVia = (typeof netRouteVias)[number]
export type NetRouteDns = (typeof netRouteDns)[number]

// Маршрут исходящих запросов сервера: `match` — точный хост, `*.домен`
// (поддомены) или `*` (по умолчанию, удалить нельзя). Сопоставляется только
// с хостом адреса, не с подстрокой URL (services/net)
export const netRoutes = sqliteTable('net_routes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  match: text('match').notNull().unique(),
  via: text('via', { enum: netRouteVias }).notNull(),
  // `host:port` прокси; null у `direct`
  proxyAddress: text('proxy_address'),
  // Шифртекст (services/secrets)
  proxyUsername: text('proxy_username'),
  proxyPassword: text('proxy_password'),
  dns: text('dns', { enum: netRouteDns }).notNull().default('system'),
  dohUrl: text('doh_url'),
  position: integer('position').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type NetRoute = typeof netRoutes.$inferSelect

// Настройки сервера ключ — значение (JSON). Секреты внутри — шифртекстом
export const serverSettings = sqliteTable('server_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})
