import type { TorznabCaps } from '../services/torznab/caps.ts'
import type { MediaInfo } from '../services/media/probe.ts'
import { randomUUID } from 'node:crypto'
import {
  blob,
  customType,
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

// IMDb ID тайтла TMDB: в списках TMDB его нет, а оценки ищутся по нему.
// `imdb_id` null — у TMDB его нет, повторно до срока не спрашиваем. Это данные
// TMDB: хранятся не дольше их предела
export const titleExternalIds = sqliteTable(
  'title_external_ids',
  {
    type: text('type', { enum: ['movie', 'tv'] }).notNull(),
    tmdbId: integer('tmdb_id').notNull(),
    imdbId: text('imdb_id'),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  table => [
    primaryKey({ columns: [table.type, table.tmdbId] }),
    index('title_external_ids_fetched_at_idx').on(table.fetchedAt),
  ],
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
// Сервисы, чьи оценки видны на постерах витрины; своя оценка видна всегда
export const posterRatingSources = ['tmdb', 'imdb'] as const

export type PosterRatingSource = (typeof posterRatingSources)[number]

// Набор сервисов в тексте через запятую: столбец остаётся текстовым, и смена
// формата не требует пересоздавать таблицу. Пустая строка — ни одного
const posterRatingSet = customType<{
  data: PosterRatingSource[]
  driverData: string
}>({
  dataType: () => 'text',
  // Без повторов и в порядке поставщиков, как бы ни прислал клиент
  toDriver: value =>
    posterRatingSources.filter(source => value.includes(source)).join(','),
  fromDriver: value =>
    posterRatingSources.filter(source => value.split(',').includes(source)),
})

export const subtitleSizes = ['s', 'm', 'l'] as const
export const subtitleBackgrounds = ['none', 'shadow', 'box'] as const

/** Настройки плеера профиля; чего нет в записи — умолчания сервиса профилей */
export interface PlayerSettings {
  /** Следующая серия запускается сама после отсчёта */
  autoNext: boolean
  subtitleSize: (typeof subtitleSizes)[number]
  subtitleBackground: (typeof subtitleBackgrounds)[number]
}

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
  // Значение по умолчанию ставит приложение: сменить DEFAULT в SQLite можно
  // только пересозданием таблицы, а её удаление в транзакции миграций каскадом
  // стёрло бы прогресс и списки профилей
  posterRatings: posterRatingSet('poster_rating')
    .notNull()
    .$defaultFn(() => ['tmdb']),
  player: text('player', { mode: 'json' }).$type<Partial<PlayerSettings>>(),
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
// Распознавание раздачи без тайтла (добавленной в панели) по имени:
// `matched` — узнали сами, `unsure` — похоже на `match_suggestion`, ждём
// подтверждения, `unmatched` — не узнали, `ignored` — владелец сказал «не
// фильм и не сериал», `user` — тайтл выбрал владелец
export const torrentMatchStatuses = [
  'matched',
  'unsure',
  'unmatched',
  'ignored',
  'user',
] as const

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
  // Распознавание по имени; null — раздачу выбрали из карточки или ещё не
  // распознавали
  matchStatus: text('match_status', { enum: torrentMatchStatuses }),
  matchSuggestion: text('match_suggestion'),
  retention: text('retention', { enum: torrentRetentions })
    .notNull()
    .default('cache'),
  // Файлы, которые качаются целиком; остальные — только то, что читает поток
  selectedFiles: text('selected_files', { mode: 'json' }).$type<number[]>(),
  pauseReason: text('pause_reason', { enum: torrentPauseReasons }),
  // Каталог файлов раздачи; null — каталог загрузок из окружения, за его
  // сменой в compose раздача идёт сама
  downloadDir: text('download_dir'),
  // Кадр видео из ffprobe при просмотре: точное разрешение раздачи в «Источниках»
  videoWidth: integer('video_width'),
  videoHeight: integer('video_height'),
  addedAt: integer('added_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastAccessAt: integer('last_access_at', { mode: 'timestamp_ms' }),
})

export type Torrent = typeof torrents.$inferSelect

export const storageMoveKinds = ['downloads', 'library'] as const
// `running` продолжается после перезапуска сервера
export const storageMoveStatuses = [
  'running',
  'done',
  'failed',
  'cancelled',
] as const

// Перенос загрузок или своей раскладки в другую папку. Элементы не хранятся:
// переносится всё, что лежит не в `target`, и каждый элемент переключается
// сразу после своей копии
export const storageMoves = sqliteTable('storage_moves', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  kind: text('kind', { enum: storageMoveKinds }).notNull(),
  target: text('target').notNull(),
  status: text('status', { enum: storageMoveStatuses }).notNull(),
  bytesTotal: integer('bytes_total').notNull().default(0),
  bytesDone: integer('bytes_done').notNull().default(0),
  itemsTotal: integer('items_total').notNull().default(0),
  itemsDone: integer('items_done').notNull().default(0),
  error: text('error'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
})

export type StorageMove = typeof storageMoves.$inferSelect

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
    // Смотрели файл библиотеки: позиция из плеера, как и с раздачей. Без
    // внешнего ключа: `ADD COLUMN` в SQLite не пересоздаёт таблицу, а убранный
    // из библиотеки файл просто не найдётся
    mediaFileId: text('media_file_id'),
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

// Личное о тайтле у профиля: списки, своя оценка и «Брошено». Статус
// «смотрю / просмотрено / ждём» не хранится — его считают по `title_progress`.
// Строка без единого признака удаляется
export const profileTitles = sqliteTable(
  'profile_titles',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    titleId: text('title_id').notNull(),
    watchlistAt: integer('watchlist_at', { mode: 'timestamp_ms' }),
    favoriteAt: integer('favorite_at', { mode: 'timestamp_ms' }),
    // 1–10
    rating: integer('rating'),
    ratedAt: integer('rated_at', { mode: 'timestamp_ms' }),
    // Действует, пока после него нет нового просмотра тайтла
    droppedAt: integer('dropped_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    primaryKey({ columns: [table.profileId, table.titleId] }),
    index('profile_titles_watchlist_idx').on(
      table.profileId,
      table.watchlistAt,
    ),
    index('profile_titles_favorite_idx').on(table.profileId, table.favoriteAt),
    index('profile_titles_rated_idx').on(table.profileId, table.ratedAt),
  ],
)

export type ProfileTitle = typeof profileTitles.$inferSelect

// Подборка — свой список тайтлов, общий на сервер. Видят её все профили,
// кроме скрытых в `collection_hidden_profiles`
export const collections = sqliteTable(
  'collections',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    // Без учёта регистра: «Новогоднее» и «новогоднее» — одна подборка
    nameKey: text('name_key').notNull(),
    showOnHome: integer('show_on_home', { mode: 'boolean' })
      .notNull()
      .default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [uniqueIndex('collections_name_key_idx').on(table.nameKey)],
)

export type Collection = typeof collections.$inferSelect

export const collectionTitles = sqliteTable(
  'collection_titles',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    titleId: text('title_id').notNull(),
    addedAt: integer('added_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    addedByProfileId: text('added_by_profile_id').references(
      () => profiles.id,
      { onDelete: 'set null' },
    ),
  },
  table => [
    primaryKey({ columns: [table.collectionId, table.titleId] }),
    index('collection_titles_added_idx').on(table.collectionId, table.addedAt),
  ],
)

export const collectionHiddenProfiles = sqliteTable(
  'collection_hidden_profiles',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
  },
  table => [primaryKey({ columns: [table.collectionId, table.profileId] })],
)

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

// `video` — фильмы и сериалы, сопоставляются с каталогом; `home` — домашнее
// видео без каталога
export const libraryKinds = ['video', 'home'] as const
// Подсказка папки «Фильмы и сериалы»: только сужает поиск в каталоге
export const libraryFolderHints = ['auto', 'movies', 'shows'] as const
// `empty` — папка читается, медиа в ней нет и не было: это норма.
// `offline` — пути нет, диск отвалился или папка опустела после скана с файлами
export const libraryFolderStatuses = [
  'ok',
  'empty',
  'offline',
  'denied',
  'scanning',
] as const

export const libraries = sqliteTable('libraries', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  kind: text('kind', { enum: libraryKinds }).notNull(),
  name: text('name').notNull(),
  // Своя раскладка: в неё пишет только Torsher, она одна и не удаляется
  managed: integer('managed', { mode: 'boolean' }).notNull().default(false),
  // glob по относительному пути
  exclude: text('exclude', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []),
  watch: integer('watch', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type Library = typeof libraries.$inferSelect

export const libraryFolders = sqliteTable('library_folders', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  libraryId: text('library_id')
    .notNull()
    .references(() => libraries.id, { onDelete: 'cascade' }),
  // Путь, как его видит сервер (в образе — внутри контейнера)
  path: text('path').notNull(),
  // Папка своей раскладки из `LIBRARY_PATH`: её путь идёт за сменой
  // окружения. У папок, выбранных в панели, путь не меняется
  followsEnv: integer('follows_env', { mode: 'boolean' })
    .notNull()
    .default(false),
  hint: text('hint', { enum: libraryFolderHints }).notNull().default('auto'),
  status: text('status', { enum: libraryFolderStatuses })
    .notNull()
    .default('ok'),
  // `st_dev` корня при последнем удачном скане: сменился на родительский —
  // диск отмонтирован, а точка монтирования осталась
  device: integer('device'),
  // Медиафайлов на последнем скане: папка опустела после N > 0 — `offline`
  fileCount: integer('file_count').notNull().default(0),
  scannedAt: integer('scanned_at', { mode: 'timestamp_ms' }),
  error: text('error'),
})

export type LibraryFolder = typeof libraryFolders.$inferSelect

// От кого библиотека скрыта на витрине; по умолчанию её видят все профили
export const libraryHiddenProfiles = sqliteTable(
  'library_hidden_profiles',
  {
    libraryId: text('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
  },
  table => [primaryKey({ columns: [table.libraryId, table.profileId] })],
)

export const mediaFileStates = ['present', 'missing'] as const
// Как файл раздачи попал в свою раскладку; у подключённых папок — null
export const mediaLinkModes = ['hardlink', 'reflink', 'copy'] as const
export const mediaMatchStatuses = [
  'matched',
  'unsure',
  'unmatched',
  'ignored',
] as const
export const mediaMatchSources = [
  'torrent',
  'name_id',
  'nfo',
  'parser',
  'user',
] as const
export const mediaCapturedSources = ['tags', 'name', 'file', 'user'] as const

export type MediaLinkMode = (typeof mediaLinkModes)[number]

// Файл в папке библиотеки. Файлы раздач в кэше сюда не попадают: они
// недокачаны и живут в `torrents.files`
export const mediaFiles = sqliteTable(
  'media_files',
  {
    // Стабилен: на него ссылаются прогресс домашнего видео и внешние клиенты
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    folderId: text('folder_id')
      .notNull()
      .references(() => libraryFolders.id, { onDelete: 'cascade' }),
    // От корня папки, NFC, через `/`
    relPath: text('rel_path').notNull(),
    size: integer('size').notNull(),
    mtime: integer('mtime', { mode: 'timestamp_ms' }).notNull(),
    // Узнаёт переименование и общий с раздачей хардлинк
    inode: integer('inode'),
    state: text('state', { enum: mediaFileStates })
      .notNull()
      .default('present'),
    missingSince: integer('missing_since', { mode: 'timestamp_ms' }),
    // Откуда файл: раздача и её файл. Раздачу удалили — файл остаётся
    torrentId: text('torrent_id').references(() => torrents.id, {
      onDelete: 'set null',
    }),
    fileIndex: integer('file_index'),
    linkMode: text('link_mode', { enum: mediaLinkModes }),
    probe: text('probe', { mode: 'json' }).$type<MediaInfo>(),
    duration: real('duration'),
    probedAt: integer('probed_at', { mode: 'timestamp_ms' }),
    // Размер и время изменения на момент пробы: файл изменился — пробуем заново
    probeKey: text('probe_key'),
    // Каталожный ID (`tmdb:movie:27205`); у фильма сезон и серия — 0
    titleId: text('title_id'),
    season: integer('season'),
    episode: integer('episode'),
    // Последняя серия файла с несколькими сериями (`S01E01-E02`)
    episodeTo: integer('episode_to'),
    // Вторая версия того же фильма или серии: `2160p`, `Director's Cut`
    version: text('version'),
    matchStatus: text('match_status', { enum: mediaMatchStatuses }),
    // Кандидат при `unsure`: владелец подтверждает его в панели
    matchSuggestion: text('match_suggestion'),
    matchSource: text('match_source', { enum: mediaMatchSources }),
    // Папка-«релиз», внутри которой файлы сопоставлялись вместе
    matchGroup: text('match_group'),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' }),
    capturedAtSource: text('captured_at_source', {
      enum: mediaCapturedSources,
    }),
    // Альбом домашнего видео — относительный путь папки, '' — без альбома
    album: text('album'),
    thumb: text('thumb'),
    addedAt: integer('added_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('media_files_folder_path_idx').on(
      table.folderId,
      table.relPath,
    ),
    index('media_files_title_idx').on(
      table.titleId,
      table.season,
      table.episode,
    ),
    index('media_files_torrent_idx').on(table.torrentId, table.fileIndex),
    index('media_files_added_at_idx').on(table.addedAt),
    index('media_files_album_idx').on(table.album, table.capturedAt),
  ],
)

export type MediaFile = typeof mediaFiles.$inferSelect
