import type { TorznabCaps } from '../services/torznab/caps.ts'
import { randomUUID } from 'node:crypto'
import {
  index,
  integer,
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
