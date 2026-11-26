import type { Buffer } from 'node:buffer'
import type { z } from 'zod'
import type { HttpAddon } from '../../db/schema.ts'
import type {
  createHttpAddon,
  HttpAddonErrorKind,
  HttpAddonResource,
  HttpAddonSelections,
  inspectHttpAddon,
  testHttpAddon,
  updateHttpAddon,
} from '../../dto/httpAddons.ts'
import type { AddonManifest } from './manifest.ts'
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { httpAddons } from '../../db/schema.ts'
import { BodyTooLargeError, readBodyLimited } from '../net/body.ts'
import { decryptSecret, encryptSecret } from '../secrets/index.ts'
import { manifestUrl, parseAddonManifest } from './manifest.ts'
import {
  AddonError,
  guardedAddonFetch,
  previewAddonAddress,
} from './transport.ts'

const MAX_ADDONS = 24
const APPROVAL_TTL = 10 * 60_000
const MAX_APPROVALS = 64

interface Approval {
  owner: string
  id: string | undefined
  url: string
  addresses: string[]
  expiresAt: number
}

const approvals = new Map<string, Approval>()
const controllers = new Map<
  string,
  { revision: string, controller: AbortController }
>()
const listeners = new Set<(id: string, previousRevision: string) => void>()

export function onAddonChanged(
  listener: (id: string, previousRevision: string) => void,
) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function invalidateAddon(previous: HttpAddon) {
  const active = controllers.get(previous.id)
  if (active?.revision === previous.revision) {
    controllers.delete(previous.id)
    active.controller.abort(new AddonError('not_found'))
  }
  for (const [id, approval] of approvals) {
    if (approval.id === previous.id)
      approvals.delete(id)
  }
  for (const listener of listeners) listener(previous.id, previous.revision)
}

export function addonRevisionSignal(addon: HttpAddon) {
  const current = getHttpAddon(addon.id)
  if (!current?.enabled || current.revision !== addon.revision)
    return AbortSignal.abort(new AddonError('not_found'))
  const active = controllers.get(addon.id)
  if (active?.revision === addon.revision)
    return active.controller.signal
  const controller = new AbortController()
  controllers.set(addon.id, { revision: addon.revision, controller })
  return controller.signal
}

function addons() {
  return getDb()
    .select()
    .from(httpAddons)
    .orderBy(asc(httpAddons.createdAt), asc(httpAddons.id))
    .all()
}

function getHttpAddon(id: string) {
  return getDb().select().from(httpAddons).where(eq(httpAddons.id, id)).get()
}

function checkedAddon(id: string) {
  const addon = getHttpAddon(id)
  if (!addon)
    throw new AddonError('not_found')
  return addon
}

function isResourceEnabled(addon: HttpAddon, resource: HttpAddonResource) {
  return (
    addon.enabled
    && (resource === 'catalog'
      ? addon.selections.catalogs.length > 0
      : addon.selections[resource])
  )
}

export function listEnabledAddons(resource: HttpAddonResource) {
  return addons().filter(addon => isResourceEnabled(addon, resource))
}

export function currentAddon(
  id: string,
  revision: string,
  resource: HttpAddonResource,
) {
  const addon = getHttpAddon(id)
  return addon?.revision === revision && isResourceEnabled(addon, resource)
    ? addon
    : undefined
}

export function configuredManifestUrl(addon: HttpAddon) {
  try {
    return manifestUrl(decryptSecret(addon.encryptedUrl))
  }
  catch {
    throw new AddonError('unavailable')
  }
}

function inspect(input: z.infer<typeof inspectHttpAddon>) {
  const addon = input.id ? checkedAddon(input.id) : undefined
  const url = input.url
    ? manifestUrl(input.url)
    : configuredManifestUrl(addon!)
  return { addon, url }
}

export async function previewHttpAddon(
  owner: string,
  input: z.infer<typeof inspectHttpAddon>,
) {
  const { addon, url } = inspect(input)
  const target = await previewAddonAddress(url)
  if (!target.private)
    return { origin: url.origin, addresses: target.addresses }

  const now = Date.now()
  for (const [id, preview] of approvals) {
    if (preview.expiresAt <= now)
      approvals.delete(id)
  }
  if (approvals.size >= MAX_APPROVALS)
    throw new AddonError('busy')
  const approvalId = randomUUID()
  approvals.set(approvalId, {
    owner,
    id: addon?.id,
    url: url.href,
    addresses: target.addresses,
    expiresAt: now + APPROVAL_TTL,
  })
  return { origin: url.origin, addresses: target.addresses, approvalId }
}

function approvalFor(
  owner: string,
  approvalId: string | undefined,
  url: URL,
  addon?: HttpAddon,
) {
  if (!approvalId)
    return undefined
  const approval = approvals.get(approvalId)
  if (
    !approval
    || approval.owner !== owner
    || approval.id !== addon?.id
    || approval.url !== url.href
    || approval.expiresAt <= Date.now()
  ) {
    throw new AddonError('needs_confirmation')
  }
  return approval
}

export async function readAddonJson(
  result: Awaited<ReturnType<typeof guardedAddonFetch>>,
  maxBytes: number,
): Promise<unknown> {
  try {
    if (!result.response.ok) {
      throw new AddonError(
        result.response.status === 429 ? 'rate_limited' : 'unavailable',
      )
    }
    let payload: Buffer
    try {
      payload = await readBodyLimited(result.response, maxBytes)
    }
    catch (error) {
      if (error instanceof BodyTooLargeError)
        throw new AddonError('bad_response')
      throw new AddonError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout'
          : 'unavailable',
      )
    }
    try {
      return JSON.parse(payload.toString('utf8'))
    }
    catch {
      throw new AddonError('bad_response')
    }
  }
  finally {
    await result.close()
  }
}

async function loadManifest(
  owner: string,
  url: URL,
  approvalId: string | undefined,
  addon?: HttpAddon,
) {
  const approval = approvalFor(owner, approvalId, url, addon)
  const sameUrl = addon && configuredManifestUrl(addon).href === url.href
  const lanAddresses
    = approval?.addresses ?? (sameUrl ? addon.lanAddresses : [])
  const result = await guardedAddonFetch(
    url,
    {
      origin: url.origin,
      lanAddresses,
    },
    { kind: 'json' },
  )
  const payload = await readAddonJson(result, 256 * 1024)
  const manifest = parseAddonManifest(payload, url, new URL(result.url))
  return { manifest, lanAddresses }
}

function capabilities(manifest: AddonManifest) {
  return {
    name: manifest.name,
    stream: manifest.resources.some(resource => resource.name === 'stream'),
    subtitles: manifest.resources.some(
      resource => resource.name === 'subtitles',
    ),
    catalogs: manifest.catalogs.map(({ key, name, type }) => ({
      key,
      name,
      type,
    })),
  }
}

function effectiveSelections(
  manifest: AddonManifest,
  requested?: HttpAddonSelections,
) {
  const enabled = capabilities(manifest)
  const catalogKeys = new Set(requested?.catalogs)
  return {
    stream: enabled.stream && requested?.stream === true,
    subtitles: enabled.subtitles && requested?.subtitles === true,
    catalogs: enabled.catalogs
      .filter(row => catalogKeys.has(row.key))
      .map(row => row.key),
  }
}

function ownerView(addon: HttpAddon) {
  return {
    id: addon.id,
    origin: addon.origin,
    enabled: addon.enabled,
    capabilities: capabilities(addon.manifest),
    selections: addon.selections,
    lanAddresses: addon.lanAddresses,
    checkedAt: addon.checkedAt.toISOString(),
    checkError: addon.checkError,
  }
}

export function listHttpAddons() {
  return { items: addons().map(ownerView) }
}

export async function testHttpAddonManifest(
  owner: string,
  input: z.infer<typeof testHttpAddon>,
) {
  const { addon, url } = inspect(input)
  return capabilities(
    (await loadManifest(owner, url, input.approvalId, addon)).manifest,
  )
}

export async function insertHttpAddon(
  owner: string,
  input: z.infer<typeof createHttpAddon>,
) {
  const url = manifestUrl(input.url)
  const { manifest, lanAddresses } = await loadManifest(
    owner,
    url,
    input.approvalId,
  )
  const db = getDb()
  const row = db.transaction(() => {
    approvalFor(owner, input.approvalId, url)
    if (addons().length >= MAX_ADDONS)
      throw new AddonError('busy')
    const now = new Date()
    return db
      .insert(httpAddons)
      .values({
        id: randomUUID(),
        origin: url.origin,
        encryptedUrl: encryptSecret(url.href),
        manifest,
        selections: effectiveSelections(manifest, input.selections),
        lanAddresses,
        enabled: true,
        revision: randomUUID(),
        createdAt: now,
        checkedAt: now,
      })
      .returning()
      .get()
  })
  if (input.approvalId)
    approvals.delete(input.approvalId)
  return ownerView(row)
}

function optimisticUpdate(
  before: HttpAddon,
  fields: Partial<typeof httpAddons.$inferInsert>,
) {
  const row = getDb()
    .update(httpAddons)
    .set(fields)
    .where(
      and(
        eq(httpAddons.id, before.id),
        eq(httpAddons.revision, before.revision),
      ),
    )
    .returning()
    .get()
  if (!row)
    throw new AddonError('conflict')
  if (row.revision !== before.revision)
    invalidateAddon(before)
  return ownerView(row)
}

export async function patchHttpAddon(
  owner: string,
  id: string,
  input: z.infer<typeof updateHttpAddon>,
) {
  const addon = checkedAddon(id)
  const url
    = input.url !== undefined
      ? manifestUrl(input.url)
      : input.approvalId
        ? configuredManifestUrl(addon)
        : undefined
  const checked = url
    ? await loadManifest(owner, url, input.approvalId, addon)
    : undefined
  if (url)
    approvalFor(owner, input.approvalId, url, addon)
  const manifest = checked?.manifest ?? addon.manifest
  const selections = effectiveSelections(
    manifest,
    input.selections ?? addon.selections,
  )
  const enabled = input.enabled ?? addon.enabled
  if (enabled && addon.checkError === 'needs_confirmation' && !checked)
    throw new AddonError('needs_confirmation')
  const changed
    = input.url !== undefined
      || input.approvalId !== undefined
      || enabled !== addon.enabled
      || JSON.stringify(selections) !== JSON.stringify(addon.selections)
  return optimisticUpdate(addon, {
    manifest,
    selections,
    enabled,
    ...(changed ? { revision: randomUUID() } : {}),
    ...(checked
      ? {
          lanAddresses: checked.lanAddresses,
          checkedAt: new Date(),
          checkError: null,
        }
      : {}),
    ...(input.url && url
      ? { origin: url.origin, encryptedUrl: encryptSecret(url.href) }
      : {}),
  })
}

export async function recheckStoredHttpAddon(
  owner: string,
  id: string,
  approvalId?: string,
) {
  const addon = checkedAddon(id)
  const url = configuredManifestUrl(addon)
  let checked: Awaited<ReturnType<typeof loadManifest>>
  try {
    if (addon.checkError === 'needs_confirmation' && !approvalId)
      throw new AddonError('needs_confirmation')
    checked = await loadManifest(owner, url, approvalId, addon)
    approvalFor(owner, approvalId, url, addon)
  }
  catch (error) {
    const checkError: HttpAddonErrorKind
      = error instanceof AddonError ? error.kind : 'unavailable'
    return optimisticUpdate(addon, { checkedAt: new Date(), checkError })
  }
  const changed
    = JSON.stringify(checked.manifest) !== JSON.stringify(addon.manifest)
      || JSON.stringify(checked.lanAddresses) !== JSON.stringify(addon.lanAddresses)
  const view = optimisticUpdate(addon, {
    manifest: checked.manifest,
    selections: effectiveSelections(checked.manifest, addon.selections),
    lanAddresses: checked.lanAddresses,
    checkedAt: new Date(),
    checkError: null,
    ...(changed ? { revision: randomUUID() } : {}),
  })
  if (approvalId)
    approvals.delete(approvalId)
  return view
}

export function removeHttpAddon(id: string) {
  const addon = getDb()
    .delete(httpAddons)
    .where(eq(httpAddons.id, id))
    .returning()
    .get()
  if (!addon)
    throw new AddonError('not_found')
  invalidateAddon(addon)
}
