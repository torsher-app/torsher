import { z } from 'zod'
import { netRouteDns, netRouteVias } from '../db/schema.ts'

// Маска и адреса разбирает сервис: ошибка разбора приходит с полем (422)
const match = z.string().trim().min(1).max(253)
const proxy = z.string().trim().min(1).max(300)
// Учётные данные прокси только на вход: ни один ответ их не содержит
const credential = z.string().max(300)
const dohUrl = z.string().trim().min(1).max(2000)

export const netRouteFields = ['match', 'proxy', 'dohUrl'] as const
export const netRouteErrorKinds = [
  'invalid',
  'duplicate',
  'default_route',
] as const

export const netRouteErrorResponse = z
  .object({
    message: z.string(),
    field: z.enum(netRouteFields),
    kind: z.enum(netRouteErrorKinds),
  })
  .meta({ id: 'netRouteErrorResponse' })

export const netRoute = z
  .object({
    id: z.string(),
    match: z.string(),
    // Маршрут `*`: удалить и сменить маску нельзя
    isDefault: z.boolean(),
    via: z.enum(netRouteVias),
    // `host:port`; null у `direct`
    proxy: z.string().nullable(),
    // Маршрут по умолчанию идёт через прокси из окружения (`HTTPS_PROXY`)
    envProxy: z.boolean(),
    hasUsername: z.boolean(),
    hasPassword: z.boolean(),
    dns: z.enum(netRouteDns),
    dohUrl: z.string().nullable(),
    updatedAt: z.string(),
  })
  .meta({ id: 'netRoute' })

export const netRouteList = z
  .object({ items: z.array(netRoute) })
  .meta({ id: 'netRouteList' })

export const createNetRoute = z
  .object({
    match,
    via: z.enum(netRouteVias),
    proxy: proxy.optional(),
    username: credential.optional(),
    password: credential.optional(),
    dns: z.enum(netRouteDns).default('system'),
    dohUrl: dohUrl.optional(),
  })
  .meta({ id: 'createNetRoute' })

export const updateNetRoute = z
  .object({
    match: match.optional(),
    via: z.enum(netRouteVias).optional(),
    proxy: proxy.optional(),
    // null — убрать сохранённое значение, пусто или нет поля — оставить
    username: credential.nullable().optional(),
    password: credential.nullable().optional(),
    dns: z.enum(netRouteDns).optional(),
    dohUrl: dohUrl.nullable().optional(),
  })
  .meta({ id: 'updateNetRoute' })

export const netRouteOrder = z
  .object({ ids: z.array(z.string().min(1).max(100)).max(500) })
  .meta({ id: 'netRouteOrder' })

export const dnsProviderList = z
  .object({
    items: z.array(
      z.object({
        id: z.enum(netRouteDns),
        name: z.string(),
        url: z.string(),
      }),
    ),
  })
  .meta({ id: 'dnsProviderList' })

export const hostKinds = ['tmdb', 'tmdb_images', 'manager', 'indexer'] as const
export const hostStatuses = [
  'ok',
  'dns',
  'doh',
  'timeout',
  'refused',
  'tls',
  'http',
] as const

export const netHost = z
  .object({
    // origin адреса: по нему хост проверяется отдельно
    id: z.string(),
    // Хост с портом, если он не стандартный
    host: z.string(),
    hostname: z.string(),
    kind: z.enum(hostKinds),
    label: z.string(),
    route: z.object({
      id: z.string(),
      match: z.string(),
      via: z.enum(netRouteVias),
      dns: z.enum(netRouteDns),
      envProxy: z.boolean(),
    }),
    checking: z.boolean(),
    // null — ещё не проверялся
    status: z.enum(hostStatuses).nullable(),
    httpStatus: z.number().int().nullable(),
    latencyMs: z.number().int().nullable(),
    dnsSpoofed: z.boolean(),
    checkedAt: z.string().nullable(),
  })
  .meta({ id: 'netHost' })

export const netCheckState = z
  .object({
    running: z.boolean(),
    done: z.number().int(),
    total: z.number().int(),
    finishedAt: z.string().nullable(),
    hosts: z.array(netHost),
  })
  .meta({ id: 'netCheckState' })

export const startNetCheck = z
  .object({
    // Без хоста — проверить все
    host: z.string().min(1).max(2000).optional(),
  })
  .meta({ id: 'startNetCheck' })

export const tmdbDefaultKeys = ['env', 'app'] as const
export const tmdbKeySources = ['custom', ...tmdbDefaultKeys, 'none'] as const

export const imdbDatasetStates = [
  'off',
  'empty',
  'updating',
  'ready',
  'error',
] as const
export const imdbDatasetErrorKinds = ['unavailable', 'invalid'] as const

// Выгрузка оценок IMDb на этом сервере
export const imdbDatasetStatus = z
  .object({
    enabled: z.boolean(),
    // off — выключено; empty — включено, выгрузки ещё нет; error — не скачалась
    // ни разу; при ошибке поверх прежней выгрузки state — ready, а error заполнен
    state: z.enum(imdbDatasetStates),
    // Дата выгрузки у IMDb (ISO)
    updatedAt: z.string().optional(),
    // Последний ответ IMDb без ошибки (ISO)
    checkedAt: z.string().optional(),
    count: z.number().int().optional(),
    error: z
      .object({
        kind: z.enum(imdbDatasetErrorKinds),
        at: z.string(),
      })
      .optional(),
  })
  .meta({ id: 'imdbDatasetStatus' })

export const metadataSettings = z
  .object({
    tmdb: z.object({
      // custom — свой ключ из панели, env — ключ из окружения сервера,
      // app — ключ приложения из образа, none — ключа нет
      source: z.enum(tmdbKeySources),
      // Ключ без своего: env или app; null — свой ключ убрать нельзя
      defaultKey: z.enum(tmdbDefaultKeys).nullable(),
    }),
    imdb: imdbDatasetStatus,
  })
  .meta({ id: 'metadataSettings' })

export const updateImdbSettings = z
  .object({
    enabled: z.boolean(),
  })
  .meta({ id: 'updateImdbSettings' })

// Ключ API v3 или токен чтения v4; только на вход
const tmdbKey = z.string().trim().min(16).max(1000)

export const updateMetadataSettings = z
  .object({
    // null — убрать свой ключ и вернуться к ключу из окружения или приложения
    tmdbKey: tmdbKey.nullable(),
  })
  .meta({ id: 'updateMetadataSettings' })

export const checkMetadataKey = z
  .object({
    // Без ключа — проверить текущий ключ сервера
    tmdbKey: tmdbKey.optional(),
  })
  .meta({ id: 'checkMetadataKey' })

export const tmdbCheckKinds = ['rejected', 'unavailable', 'missing'] as const

export const metadataKeyCheck = z
  .object({
    ok: z.boolean(),
    // Почему не прошла: ключ не принят, TMDB недоступен, ключа нет
    kind: z.enum(tmdbCheckKinds).nullable(),
  })
  .meta({ id: 'metadataKeyCheck' })
