import type { Language } from '@torsher/i18n'
import type { NotificationChannel } from '../../../db/schema.ts'
import type { NotificationGroup } from '../../../dto/notifications.ts'
import type { AnyChannelProvider } from './index.ts'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../../db/index.ts'
import { notificationChannels } from '../../../db/schema.ts'
import {
  decryptSecret,
  encryptSecret,
  SecretError,
} from '../../secrets/index.ts'
import { providerOf } from './index.ts'
import { DeliveryError } from './types.ts'

export interface ChannelInput {
  kind: NotificationChannel['kind']
  name: string
  enabled: boolean
  language: Language
  panelUrl?: string | null
  // Секрет пустой или без поля — оставить сохранённый, `null` — удалить
  config: Record<string, unknown>
  events: NotificationGroup[]
  includeWarnings: boolean
  notifyResolved: boolean
}

/** Настройки не прошли схему провайдера: поля — для подсветки в форме */
export class ChannelConfigError extends Error {
  readonly fields: string[]

  constructor(fields: string[]) {
    super('Invalid channel settings')
    this.name = 'ChannelConfigError'
    this.fields = fields
  }
}

export class UnknownChannelKindError extends Error {
  constructor(kind: string) {
    super(`Unknown channel kind: ${kind}`)
    this.name = 'UnknownChannelKindError'
  }
}

function providerFor(kind: string) {
  const provider = providerOf(kind)

  if (!provider)
    throw new UnknownChannelKindError(kind)

  return provider
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === ''
}

/** Сохранённые настройки в открытом виде; нерасшифровываемый секрет — ошибка доставки */
export function decryptConfig(
  provider: AnyChannelProvider,
  stored: Record<string, unknown>,
) {
  const plain: Record<string, unknown> = { ...stored }

  for (const field of provider.secretFields) {
    const value = stored[field]

    if (typeof value !== 'string')
      continue

    try {
      plain[field] = decryptSecret(value)
    }
    catch (err) {
      if (!(err instanceof SecretError))
        throw err

      throw new DeliveryError(
        'invalid_config',
        'Stored channel secret cannot be decrypted',
      )
    }
  }

  return plain
}

/** Значение поля после схемы: пустой `server` у ntfy — сервер по умолчанию */
function fieldValue(
  provider: AnyChannelProvider,
  field: string,
  value: unknown,
) {
  if (!(provider.schema instanceof z.ZodObject))
    return value

  const parsed = (
    provider.schema.shape[field] as z.ZodType | undefined
  )?.safeParse(value)

  return parsed?.success ? parsed.data : value
}

/** Прежнее значение секрета; не расшифровывается — `undefined` */
function tryDecrypt(value: unknown) {
  if (typeof value !== 'string')
    return undefined

  try {
    return decryptSecret(value)
  }
  catch (err) {
    if (err instanceof SecretError)
      return undefined

    throw err
  }
}

/**
 * Проверяет настройки по схеме провайдера. Секрет без поля, пустой или из
 * одних пробелов не заполнен: при правке остаётся сохранённый (панель секретов
 * не видит и не присылает их обратно), без сохранённого решает схема. `null` —
 * удалить сохранённый. Заполненный секрет не обрезается: пробелы по краям
 * пароля — его часть, токены обрезают схемы провайдеров. Сменился адрес
 * назначения — прежние секреты не переносятся: новому получателю старый токен
 * не уходит.
 */
export function resolveConfig(
  kind: string,
  input: Record<string, unknown>,
  previous?: NotificationChannel,
) {
  const provider = providerFor(kind)
  const stored = previous && previous.kind === kind ? previous.config : {}
  const secrets = new Set<string>(provider.secretFields)
  const merged: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(input)) {
    const text = typeof value === 'string' ? value.trim() : value

    // Секрет из одних пробелов — «не заполнен», а не «стереть сохранённый»
    if (isEmpty(value) || (secrets.has(field) && isEmpty(text)))
      continue

    merged[field] = secrets.has(field) ? value : text
  }

  const kept = provider.secretFields.filter(
    field =>
      isEmpty(merged[field])
      && input[field] !== null
      && !isEmpty(stored[field]),
  )
  const moved = provider.endpointFields.some((field) => {
    if (kept.includes(field) || isEmpty(stored[field]))
      return false

    const before = secrets.has(field)
      ? tryDecrypt(stored[field])
      : stored[field]

    return (
      before === undefined
      || fieldValue(provider, field, merged[field]) !== before
    )
  })
  const broken: string[] = []

  if (!moved) {
    for (const field of kept) {
      const value = tryDecrypt(stored[field])

      if (value === undefined)
        broken.push(field)
      else merged[field] = value
    }
  }

  if (broken.length)
    throw new ChannelConfigError(broken)

  const parsed = provider.schema.safeParse(merged)

  if (!parsed.success) {
    throw new ChannelConfigError([
      ...new Set(
        parsed.error.issues.map(issue => String(issue.path[0] ?? '')),
      ),
    ])
  }

  return { provider, config: parsed.data as Record<string, unknown> }
}

function encryptConfig(
  provider: AnyChannelProvider,
  config: Record<string, unknown>,
) {
  const stored: Record<string, unknown> = { ...config }

  for (const field of provider.secretFields) {
    const value = config[field]

    if (typeof value === 'string' && value)
      stored[field] = encryptSecret(value)
  }

  return stored
}

export function listChannels() {
  return getDb()
    .select()
    .from(notificationChannels)
    .orderBy(asc(notificationChannels.createdAt))
    .all()
}

export function getChannel(id: string) {
  return getDb()
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .get()
}

function rowValues(input: ChannelInput, previous?: NotificationChannel) {
  const { provider, config } = resolveConfig(
    input.kind,
    input.config,
    previous,
  )

  return {
    kind: input.kind,
    name: input.name.trim(),
    enabled: input.enabled,
    language: input.language,
    panelUrl: input.panelUrl?.trim().replace(/\/+$/, '') || null,
    config: encryptConfig(provider, config),
    events: [...new Set(input.events)],
    includeWarnings: input.includeWarnings,
    notifyResolved: input.notifyResolved,
  }
}

export function createChannel(input: ChannelInput) {
  return getDb()
    .insert(notificationChannels)
    .values(rowValues(input))
    .returning()
    .get()
}

export function updateChannel(id: string, input: ChannelInput) {
  const previous = getChannel(id)

  if (!previous)
    return undefined

  return (
    getDb()
      .update(notificationChannels)
      // Прежняя ошибка доставки относилась к старым настройкам
      .set({
        ...rowValues(input, previous),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(notificationChannels.id, id))
      .returning()
      .get()
  )
}

export function setChannelEnabled(id: string, enabled: boolean) {
  return getDb()
    .update(notificationChannels)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(notificationChannels.id, id))
    .returning()
    .get()
}

export function deleteChannel(id: string) {
  return (
    getDb()
      .delete(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .run()
      .changes > 0
  )
}

export function recordDelivery(
  id: string,
  result: { ok: true } | { ok: false, kind: string },
) {
  const now = new Date()

  getDb()
    .update(notificationChannels)
    .set(
      result.ok
        ? { lastSentAt: now, lastError: null }
        : { lastError: { kind: result.kind, at: now.toISOString() } },
    )
    .where(eq(notificationChannels.id, id))
    .run()
}

/** Канал для API: открытые поля как есть, у секретов — только признак, что задан */
export function toChannelResponse(row: NotificationChannel) {
  const provider = providerOf(row.kind)
  const secretFields = new Set<string>(provider?.secretFields ?? [])
  const config: Record<string, string | number | boolean | null> = {}
  const secrets: string[] = []

  for (const [field, value] of Object.entries(row.config)) {
    if (secretFields.has(field)) {
      if (!isEmpty(value))
        secrets.push(field)
    }
    else if (
      value === null
      || ['string', 'number', 'boolean'].includes(typeof value)
    ) {
      config[field] = value as string | number | boolean | null
    }
  }

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    language: row.language,
    panelUrl: row.panelUrl ?? undefined,
    config,
    secrets,
    events: row.events as NotificationGroup[],
    includeWarnings: row.includeWarnings,
    notifyResolved: row.notifyResolved,
    lastSentAt: row.lastSentAt?.toISOString(),
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }
}
