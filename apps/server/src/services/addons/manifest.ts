import type { HttpAddonResource, HttpAddonType } from '../../dto/httpAddons.ts'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { httpAddonType } from '../../dto/httpAddons.ts'
import { AddonError, addonUrl } from './transport.ts'

const MANIFEST_SUFFIX = '/manifest.json'
const CONTROL = /\p{Cc}/u
const PLAYBACK_RESOURCE = z.enum(['stream', 'subtitles'])
const prefixes = z.array(z.string().min(1).max(120)).max(100)
const names = z.array(z.string().min(1).max(120)).max(100)

const rawManifest = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(400),
  version: z.string().min(1).max(100),
  types: names,
  idPrefixes: prefixes.optional(),
  resources: z.array(z.unknown()).max(100),
  catalogs: z.array(z.unknown()).max(100).default([]),
  behaviorHints: z
    .object({
      configurationRequired: z.boolean().optional(),
    })
    .optional(),
})

const rawResource = z.object({
  name: PLAYBACK_RESOURCE,
  types: names,
  idPrefixes: prefixes.optional(),
})

const rawCatalog = z.object({
  type: httpAddonType,
  id: z.string().min(1).max(256),
  name: z.string().max(400).optional(),
  extra: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        isRequired: z.boolean().optional(),
      }),
    )
    .max(100)
    .default([]),
})

interface Resource {
  name: Exclude<HttpAddonResource, 'catalog'>
  types: HttpAddonType[]
  idPrefixes: string[]
}

export interface AddonCatalog {
  type: HttpAddonType
  id: string
  key: string
  name: string
  requiresSkip: boolean
}

export interface AddonManifest {
  name: string
  resources: Resource[]
  catalogs: AddonCatalog[]
}

export function manifestUrl(value: string) {
  const url = addonUrl(value)
  if (!url.pathname.endsWith(MANIFEST_SUFFIX))
    throw new AddonError('invalid_url')

  return url
}

function decodedForms(text: string) {
  const forms = [text]
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const decoded = decodeURIComponent(forms.at(-1)!)
      if (decoded === forms.at(-1))
        break
      forms.push(decoded)
    }
    catch {
      break
    }
  }
  return forms
}

function urlSecrets(url: URL) {
  const path = url.pathname.split('/')
  const basename = path.at(-1) ?? ''
  // A signed asset may encode its bearer value in the filename itself.
  const stems = decodedForms(basename).flatMap((form) => {
    const stem = /^([\w-]+)\.[a-z\d]{1,8}$/i.exec(form)?.[1]
    return stem && stem.length >= 16 ? [stem] : []
  })
  return [url.href, ...path, ...stems, ...url.searchParams.values()]
    .flatMap(decodedForms)
    .filter(Boolean)
}

/** Никаких URL и известной конфигурации аддона в видимых строках. */
export function addonText(
  value: string | undefined,
  urls: URL[],
  privateValues: string[] = [],
) {
  const text = value?.trim()
  if (!text || text.length > 240)
    return ''

  const forms = decodedForms(text)
  const secrets = [
    ...urls.flatMap(urlSecrets),
    ...privateValues.flatMap(decodedForms),
  ].filter(Boolean)
  const containsSecret = forms.some(form =>
    secrets.some(secret =>
      secret.length >= 4
        ? form.toLowerCase().includes(secret.toLowerCase())
        : form
            .toLowerCase()
            .split(/[^\p{L}\p{N}_-]+/u)
            .includes(secret.toLowerCase()),
    ),
  )
  if (
    containsSecret
    || forms.some(form => /[<>\p{Cc}\p{Cf}]|:\/\/|\bwww\./iu.test(form))
  ) {
    return ''
  }
  return text
}

function segment(value: string) {
  if (!value.trim() || value === '.' || value === '..' || CONTROL.test(value))
    throw new AddonError('bad_response')

  try {
    return encodeURIComponent(value)
  }
  catch {
    throw new AddonError('bad_response')
  }
}

function supportedTypes(types: string[]) {
  return [...new Set(types)].filter(
    (type): type is HttpAddonType => type === 'movie' || type === 'series',
  )
}

export function parseAddonManifest(
  value: unknown,
  url: URL,
  finalUrl = url,
): AddonManifest {
  const urls = [url, finalUrl]
  const parsed = rawManifest.safeParse(value)
  if (!parsed.success)
    throw new AddonError('bad_response')
  const raw = parsed.data
  if (raw.behaviorHints?.configurationRequired)
    throw new AddonError('unsupported_manifest')

  const resources = raw.resources.flatMap((entry): Resource[] => {
    const short = PLAYBACK_RESOURCE.safeParse(entry)
    const result = short.success
      ? rawResource.safeParse({
          name: short.data,
          types: raw.types,
          idPrefixes: raw.idPrefixes,
        })
      : rawResource.safeParse(entry)
    if (!result.success)
      return []
    const { name, types, idPrefixes = [] } = result.data
    const supported = supportedTypes(types)
    const clean = idPrefixes.filter(prefix => addonText(prefix, urls))
    return !supported.length || (idPrefixes.length > 0 && !clean.length)
      ? []
      : [{ name, types: supported, idPrefixes: clean }]
  })

  const seen = new Set<string>()
  const catalogs = raw.catalogs.flatMap((entry): AddonCatalog[] => {
    const result = rawCatalog.safeParse(entry)
    if (!result.success)
      return []
    const { id, type, name, extra } = result.data
    if (
      !addonText(id, urls)
      || extra.some(setting => setting.isRequired && setting.name !== 'skip')
    ) {
      return []
    }
    try {
      segment(id)
    }
    catch {
      return []
    }
    const key = createHash('sha256')
      .update(JSON.stringify([type, id]))
      .digest('hex')
    if (seen.has(key))
      return []
    seen.add(key)
    return [
      {
        type,
        id,
        key,
        name: addonText(name, urls) || addonText(id, urls),
        requiresSkip: extra.some(
          setting => setting.name === 'skip' && setting.isRequired,
        ),
      },
    ]
  })
  if (!resources.length && !catalogs.length)
    throw new AddonError('unsupported_manifest')
  return { name: addonText(raw.name, urls), resources, catalogs }
}

export function supportsAddonResource(
  manifest: AddonManifest,
  resource: HttpAddonResource,
  type: HttpAddonType,
  id: string,
) {
  if (resource === 'catalog') {
    return manifest.catalogs.some(
      catalog => catalog.type === type && catalog.id === id,
    )
  }

  return manifest.resources.some(
    entry =>
      entry.name === resource
      && entry.types.includes(type)
      && (!entry.idPrefixes.length
        || entry.idPrefixes.some(prefix => id.startsWith(prefix))),
  )
}

export function addonResourceUrl(
  base: URL,
  resource: HttpAddonResource,
  type: HttpAddonType,
  id: string,
  extra?: Record<string, string | number>,
) {
  const url = manifestUrl(base.href)
  const args = extra && Object.entries(extra)
  const suffix = args?.length
    ? `/${args.map(([key, value]) => `${segment(key)}=${segment(String(value))}`).join('&')}`
    : ''
  url.pathname = `${url.pathname.slice(0, -MANIFEST_SUFFIX.length)}/${resource}/${type}/${segment(id)}${suffix}.json`
  return url
}
