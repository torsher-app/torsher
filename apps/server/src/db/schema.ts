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
  addedAt: integer('added_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastAccessAt: integer('last_access_at', { mode: 'timestamp_ms' }),
})

export type Torrent = typeof torrents.$inferSelect

// Позиция просмотра файла раздачи. Привязка к тайтлу и серии появится вместе
// с выбором раздачи из карточки
export const watchStates = sqliteTable(
  'watch_states',
  {
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
  table => [primaryKey({ columns: [table.torrentId, table.fileIndex] })],
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
// `profile_id` появится вместе с профилями
export const titleProgress = sqliteTable(
  'title_progress',
  {
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
    primaryKey({ columns: [table.titleId, table.season, table.episode] }),
    index('title_progress_updated_at_idx').on(table.titleId, table.updatedAt),
  ],
)

export type TitleProgress = typeof titleProgress.$inferSelect
