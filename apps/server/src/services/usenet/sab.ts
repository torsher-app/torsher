import { Blob } from 'node:buffer'
import { FormData } from 'undici'
import { readBodyLimited } from '../net/body.ts'
import { TrustedHttpError, trustedHttpRequest } from '../net/trustedHttp.ts'
import { UsenetError } from './errors.ts'

const RESPONSE_LIMIT = 1024 * 1024
export const SAB_BATCH_SIZE = 25
const RECOVERY_PAGES = 4

export interface SabClient {
  url: string
  apiKey: string
  category: string
  lanAddresses: string[]
}

interface SabSlot {
  id: string
  name?: string
  originalName?: string
  status: string
  progress: number | null
  storage?: string
  loaded?: boolean
  releaseFailed: boolean
}

interface SabPage {
  jobs: SabSlot[]
  count: number
  total: number
}

export const sabDeps = { request: trustedHttpRequest }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || !value || Array.isArray(value))
    throw new UsenetError('unavailable')
  return value as Record<string, unknown>
}

function nzoId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,80}$/.test(value)
}

function connectionError(error: unknown): never {
  if (error instanceof UsenetError)
    throw error
  if (error instanceof TrustedHttpError) {
    if (error.kind === 'needs_confirmation' || error.kind === 'address_changed')
      throw new UsenetError(error.kind)
    if (error.kind === 'invalid_url' || error.kind === 'blocked_address')
      throw new UsenetError('invalid')
  }
  throw new UsenetError('unavailable')
}

async function sabRequest(
  client: SabClient,
  mode: string,
  params: Record<string, string> = {},
  form?: FormData,
) {
  try {
    const url = new URL(`${client.url}/api`)
    url.search = new URLSearchParams({
      mode,
      output: 'json',
      apikey: client.apiKey,
      ...params,
    }).toString()
    const request = await sabDeps.request(
      url,
      { origin: url.origin, lanAddresses: client.lanAddresses },
      {
        method: form ? 'POST' : 'GET',
        body: form,
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      },
    )
    try {
      const { response } = request
      if (response.status === 401 || response.status === 403)
        throw new UsenetError('auth')
      if (!response.ok)
        throw new UsenetError('unavailable')

      const data = record(
        JSON.parse(
          (await readBodyLimited(response, RESPONSE_LIMIT)).toString(),
        ),
      )
      if (data.error !== undefined) {
        if (
          data.error === 'API Key Required'
          || data.error === 'API Key Incorrect'
        ) {
          throw new UsenetError('auth')
        }
        throw new UsenetError('unavailable')
      }
      return data
    }
    finally {
      await request.close().catch(() => {})
    }
  }
  catch (error) {
    connectionError(error)
  }
}

export async function checkSab(client: SabClient) {
  const data = await sabRequest(client, 'queue', { limit: '1' })
  const queue = record(data.queue)
  if (!Array.isArray(queue.slots))
    throw new UsenetError('unavailable')

  const { version } = await sabRequest(client, 'version')
  const match
    = typeof version === 'string' && /^5\.(\d+)\.(\d+)$/.exec(version)
  if (
    !match
    || Number(match[1]) < 1
    || (Number(match[1]) === 1 && Number(match[2]) < 3)
  ) {
    throw new UsenetError('unsupported_version')
  }

  const { categories } = await sabRequest(client, 'get_cats')
  if (!Array.isArray(categories) || !categories.includes(client.category))
    throw new UsenetError('category')
}

export function sabAttemptName(jobId: string) {
  return `torsher-${jobId}`
}

export async function submitSab(
  client: SabClient,
  jobId: string,
  nzb: Uint8Array,
) {
  const name = sabAttemptName(jobId)
  const form = new FormData()
  form.set('nzbname', name)
  form.set('cat', client.category)
  form.set('pp', '2')
  form.set('script', 'None')
  form.set(
    'nzbfile',
    new Blob([Uint8Array.from(nzb)], { type: 'application/x-nzb' }),
    `${name}.nzb`,
  )
  const result = await sabRequest(client, 'addfile', {}, form)

  // A job rejected to history can return status=false with a valid ID.
  if (
    Array.isArray(result.nzo_ids)
    && result.nzo_ids.length === 1
    && nzoId(result.nzo_ids[0])
  ) {
    return result.nzo_ids[0]
  }
  throw new UsenetError('submit_uncertain')
}

function safeString(value: unknown, limit: number) {
  return typeof value === 'string' && value.length <= limit ? value : undefined
}

function progressOf(value: unknown) {
  if (
    typeof value !== 'number'
    && (typeof value !== 'string' || !/^\d{1,3}$/.test(value))
  ) {
    return null
  }
  const percentage = Number(value)
  return percentage >= 0 && percentage <= 100 ? percentage / 100 : null
}

// SABnzbd 5.1.3 postproc.py sets this exact reason when the download has no
// articles on the configured servers. Other reasons (including localized
// ones) require operator review instead of automatic fallback.
const NO_ARTICLES
  = 'Download failed - Not on your server(s) - https://sabnzbd.org/not-complete'

async function page(
  client: SabClient,
  mode: 'queue' | 'history',
  params: Record<string, string>,
): Promise<SabPage> {
  const data = record(
    (
      await sabRequest(client, mode, {
        cat: client.category,
        limit: String(SAB_BATCH_SIZE),
        ...params,
      })
    )[mode],
  )
  if (
    !Array.isArray(data.slots)
    || data.slots.length > SAB_BATCH_SIZE
    || typeof data.noofslots !== 'number'
    || !Number.isSafeInteger(data.noofslots)
    || data.noofslots < data.slots.length
  ) {
    throw new UsenetError('unavailable')
  }

  const jobs = data.slots.flatMap((value): SabSlot[] => {
    const row = record(value)
    if (!nzoId(row.nzo_id) || typeof row.status !== 'string')
      throw new UsenetError('unavailable')
    const category = mode === 'queue' ? row.cat : row.category
    if (category !== client.category)
      return []

    return [
      {
        id: row.nzo_id,
        name: safeString(mode === 'queue' ? row.filename : row.name, 1024),
        originalName: safeString(row.nzb_name, 1024),
        status: row.status,
        progress: progressOf(row.percentage),
        storage: safeString(row.storage, 4096),
        loaded: typeof row.loaded === 'boolean' ? row.loaded : undefined,
        releaseFailed: row.fail_message === NO_ARTICLES,
      },
    ]
  })
  return { jobs, count: data.slots.length, total: data.noofslots }
}

export interface SabObservation {
  state:
    | 'queued'
    | 'downloading'
    | 'postProcessing'
    | 'paused'
    | 'completed'
    | 'failed'
  progress: number | null
  storage?: string
  releaseFailed?: boolean
}

function queueObservation(row: SabSlot): SabObservation {
  return {
    state:
      row.status === 'Paused'
        ? 'paused'
        : row.status === 'Downloading'
          ? 'downloading'
          : 'queued',
    progress: row.progress,
  }
}

function historyObservation(row: SabSlot): SabObservation {
  if (row.loaded === false) {
    if (row.status === 'Completed')
      return { state: 'completed', progress: 1, storage: row.storage }
    if (row.status === 'Failed') {
      return {
        state: 'failed',
        progress: null,
        releaseFailed: row.releaseFailed,
      }
    }
  }
  return { state: 'postProcessing', progress: 1 }
}

export async function observeSab(client: SabClient, ids: string[]) {
  const result = new Map<string, SabObservation>()
  if (!ids.length)
    return result
  if (ids.length > SAB_BATCH_SIZE)
    throw new UsenetError('invalid')

  const filter = { nzo_ids: ids.join(',') }
  const queue = await page(client, 'queue', filter)
  const history = await page(client, 'history', filter)
  const expected = new Set(ids)
  for (const job of queue.jobs) {
    if (expected.has(job.id))
      result.set(job.id, queueObservation(job))
  }
  for (const job of history.jobs) {
    if (expected.has(job.id))
      result.set(job.id, historyObservation(job))
  }

  const absent = ids.filter(id => !result.has(id))
  if (absent.length) {
    const archived = await page(client, 'history', {
      nzo_ids: absent.join(','),
      archive: '1',
    })
    for (const job of archived.jobs) {
      if (absent.includes(job.id))
        result.set(job.id, historyObservation(job))
    }
  }
  return result
}

async function collectCategory(
  client: SabClient,
  mode: 'queue' | 'history',
  params: Record<string, string> = {},
) {
  const jobs: SabSlot[] = []
  for (let i = 0; i < RECOVERY_PAGES; i++) {
    const start = i * SAB_BATCH_SIZE
    const result = await page(client, mode, {
      ...params,
      start: String(start),
    })
    if (result.jobs.length !== result.count)
      return undefined
    jobs.push(...result.jobs)
    // Queue's total can count jobs outside the selected category.
    if (result.count < SAB_BATCH_SIZE || start + SAB_BATCH_SIZE >= result.total)
      return jobs
  }
}

export async function inspectSabCategory(client: SabClient) {
  const queue = await collectCategory(client, 'queue')
  const history = await collectCategory(client, 'history')
  const archived = await collectCategory(client, 'history', { archive: '1' })
  if (queue && history && archived)
    return [...queue, ...history, ...archived]
}

export async function recoverSab(client: SabClient, jobId: string) {
  const name = sabAttemptName(jobId)
  const queue = await collectCategory(client, 'queue', { search: name })
  // History search matches the present name, so inspect the returned
  // history slots to also match the untouched original NZB name.
  const history = await collectCategory(client, 'history')
  const archived = await collectCategory(client, 'history', { archive: '1' })
  if (!queue || !history || !archived)
    return undefined

  const candidates = [...queue, ...history, ...archived]
  const ids = new Set(
    candidates
      .filter(slot =>
        [slot.name, slot.originalName].some(
          value => value === name || value === `${name}.nzb`,
        ),
      )
      .map(slot => slot.id),
  )
  return ids.size === 1 ? [...ids][0] : undefined
}
