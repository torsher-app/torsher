import type { UsenetIntent } from './jobs.ts'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  followHistory,
  follows,
  usenetClients,
  usenetJobs,
} from '../../db/schema.ts'
import { encryptSecret } from '../secrets/index.ts'
import {
  activeUsenetTargets,
  blockedUsenetReleaseKeys,
  enqueueUsenet,
  pollUsenet,
  reconcileUsenetJob,
  releaseUsenetJob,
} from './jobs.ts'
import { sabAttemptName, sabDeps } from './sab.ts'

const nzb = new TextEncoder().encode(
  '<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"></nzb>',
)
const client = {
  id: 'sabnzbd',
  generation: 'synthetic-client',
  url: 'https://sab.example/gateway',
  category: 'torsher',
  remoteRoot: '/completed/torsher',
  localRoot: '/usenet-inbox',
  lanAddresses: [],
  enabled: true,
  followEnabled: true,
  verified: true,
}
const intent: UsenetIntent = {
  origin: 'manual',
  profileId: 'synthetic-profile',
  sourceId: 'synthetic-source',
  sourceRevision: 'synthetic-revision',
  releaseKey: 'synthetic-release',
  releaseTitle: 'Synthetic Film.2026.1080p.DEMO',
  titleId: 'tmdb:movie:9000001',
}

function response(body: unknown, status = 200) {
  return Promise.resolve({
    response: new Response(JSON.stringify(body), { status }),
    close: async () => {},
  })
}

function sabPage(mode: string, slots: Record<string, unknown>[] = []) {
  return response({ [mode]: { slots, noofslots: slots.length } })
}

function followIntent() {
  const follow = getDb()
    .insert(follows)
    .values({
      titleId: intent.titleId,
      kind: 'movie',
      state: 'active',
      startSeason: 0,
      startEpisode: 0,
      requireRussian: false,
      waitHours: 0,
    })
    .returning()
    .get()
  return {
    ...intent,
    origin: 'follow' as const,
    profileId: undefined,
    followId: follow.id,
  }
}

beforeAll(async () => {
  await migrateDb()
})

beforeEach(() => {
  getDb().delete(usenetJobs).run()
  getDb().delete(usenetClients).run()
  getDb().delete(followHistory).run()
  getDb().delete(follows).run()
  getDb()
    .insert(usenetClients)
    .values({
      ...client,
      encryptedApiKey: encryptSecret('test-key'),
    })
    .run()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usenet job journal', () => {
  it('reserves before receipt of the NZB and submits only once for concurrent requests', async () => {
    let requested: (() => void) | undefined
    const fetching = new Promise<Uint8Array>((resolve) => {
      requested = () => resolve(nzb)
    })
    const request = vi
      .spyOn(sabDeps, 'request')
      .mockImplementation((url, policy, options) => {
        expect(url.href).toContain('/gateway/api?mode=addfile')
        expect(policy.origin).toBe('https://sab.example')
        expect(options?.method).toBe('POST')
        expect(options?.body).toHaveProperty('get')
        const row = getDb().select().from(usenetJobs).get()!
        expect(row.state).toBe('submitting')
        expect(row.nzoId).toBeNull()
        return response({ status: true, nzo_ids: ['demo-nzo'] })
      })
    const first = enqueueUsenet(intent, () => fetching)
    expect(activeUsenetTargets(intent.titleId)).toEqual(new Set(['0:0']))

    await expect(
      enqueueUsenet({ ...intent, releaseKey: 'another' }, async () => nzb),
    ).rejects.toMatchObject({ kind: 'target_busy' })
    const repeated = await enqueueUsenet(intent, async () => nzb)
    expect(repeated.state).toBe('pending')

    requested!()
    await expect(first).resolves.toMatchObject({
      id: repeated.id,
      state: 'queued',
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('recovers the original submission after a lost reply, using the archive name', async () => {
    const request = vi
      .spyOn(sabDeps, 'request')
      .mockRejectedValueOnce(new TypeError('Lost response'))
    const follow = followIntent()
    const attempt = await enqueueUsenet(follow, async () => nzb)
    expect(attempt).toMatchObject({
      state: 'attention',
      problem: 'submit_uncertain',
    })
    const marker = sabAttemptName(attempt.id)
    request.mockImplementation((url) => {
      const mode = url.searchParams.get('mode')!
      if (mode === 'addfile')
        throw new Error('Reconciliation must not submit')
      if (url.searchParams.get('archive') === '1') {
        return sabPage(mode, [
          {
            nzo_id: 'synthetic-nzo',
            status: 'Failed',
            name: 'Changed by user',
            nzb_name: `${marker}.nzb`,
            category: 'torsher',
            loaded: false,
            fail_message: 'Displayable in SAB only',
          },
        ])
      }
      return sabPage(mode)
    })

    await expect(reconcileUsenetJob(attempt.id)).resolves.toMatchObject({
      state: 'attention',
      problem: 'download_failed',
    })
    await reconcileUsenetJob(attempt.id)
    expect(getDb().select().from(usenetJobs).get()?.nzoId).toBe(
      'synthetic-nzo',
    )
    expect(
      getDb()
        .select()
        .from(followHistory)
        .all()
        .map(row => row.kind),
    ).toEqual(['grabbed'])
    expect(
      request.mock.calls.filter(
        ([url]) => url.searchParams.get('mode') === 'addfile',
      ),
    ).toHaveLength(1)
  })

  it('returns a lost legacy pending intent to the scheduler without submitting again', async () => {
    const request = vi.spyOn(sabDeps, 'request')
    const { id } = getDb()
      .insert(usenetJobs)
      .values({
        ...intent,
        id: randomUUID(),
        clientGeneration: client.generation,
        active: true,
        state: 'pending',
      })
      .returning()
      .get()
    await pollUsenet()
    const row = getDb()
      .select()
      .from(usenetJobs)
      .where(eq(usenetJobs.id, id))
      .get()
    expect(row).toMatchObject({
      active: false,
      state: 'released',
      problem: 'interrupted',
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps a missing job out of the release blocklist and lets the owner release its target', async () => {
    vi.spyOn(sabDeps, 'request')
      .mockResolvedValueOnce(
        await response({ status: true, nzo_ids: ['synthetic-missing'] }),
      )
      .mockImplementation(url => sabPage(url.searchParams.get('mode')!))
    const job = await enqueueUsenet(followIntent(), async () => nzb)
    await expect(releaseUsenetJob(job.id)).rejects.toThrow('review_required')

    await expect(reconcileUsenetJob(job.id)).resolves.toMatchObject({
      state: 'attention',
      problem: 'job_missing',
    })
    expect(activeUsenetTargets(intent.titleId).has('0:0')).toBe(true)
    expect(blockedUsenetReleaseKeys(intent.titleId).size).toBe(0)
    await expect(releaseUsenetJob(job.id)).resolves.toMatchObject({
      state: 'released',
    })
    expect(activeUsenetTargets(intent.titleId).size).toBe(0)
  })

  it('continues polling a temporarily missing job after a network failure', async () => {
    const request = vi
      .spyOn(sabDeps, 'request')
      .mockResolvedValueOnce(
        await response({ status: true, nzo_ids: ['synthetic-missing'] }),
      )
      .mockImplementation(url => sabPage(url.searchParams.get('mode')!))
    const job = await enqueueUsenet(intent, async () => nzb)
    await pollUsenet()
    const saved = () =>
      getDb().select().from(usenetJobs).where(eq(usenetJobs.id, job.id)).get()
    expect(saved()).toMatchObject({
      state: 'attention',
      problem: 'job_missing',
    })

    request.mockRejectedValueOnce(new TypeError('Synthetic outage'))
    await expect(pollUsenet()).rejects.toThrow('unavailable')
    expect(saved()).toMatchObject({
      state: 'attention',
      problem: 'job_missing',
    })

    request.mockImplementation((url) => {
      const mode = url.searchParams.get('mode')!
      return mode === 'queue'
        ? sabPage(mode, [
            { nzo_id: 'synthetic-missing', cat: 'torsher', status: 'Queued' },
          ])
        : sabPage(mode)
    })
    await pollUsenet()
    expect(saved()).toMatchObject({ state: 'queued', problem: null })
  })

  it('blocks only a recognized final release failure and records it once', async () => {
    vi.spyOn(sabDeps, 'request')
      .mockResolvedValueOnce(
        await response({ status: true, nzo_ids: ['synthetic-failed'] }),
      )
      .mockImplementation((url) => {
        const mode = url.searchParams.get('mode')!
        return mode === 'queue'
          ? sabPage(mode)
          : sabPage(mode, [
              {
                nzo_id: 'synthetic-failed',
                category: 'torsher',
                status: 'Failed',
                loaded: false,
                fail_message:
                  'Download failed - Not on your server(s) - https://sabnzbd.org/not-complete',
              },
            ])
      })

    const job = await enqueueUsenet(followIntent(), async () => nzb)
    await expect(reconcileUsenetJob(job.id)).resolves.toMatchObject({
      state: 'failed',
      problem: 'release_failed',
    })
    await pollUsenet()
    expect(blockedUsenetReleaseKeys(intent.titleId)).toEqual(
      new Set([intent.releaseKey]),
    )
    expect(activeUsenetTargets(intent.titleId).size).toBe(0)
    expect(
      getDb()
        .select()
        .from(followHistory)
        .all()
        .map(row => row.kind),
    ).toEqual(['grabbed', 'blocklisted'])
  })

  it('preserves a confirmed release failure when observing the next job fails', async () => {
    const request = vi
      .spyOn(sabDeps, 'request')
      .mockResolvedValueOnce(
        await response({ status: true, nzo_ids: ['synthetic-failed'] }),
      )
      .mockResolvedValueOnce(
        await response({ status: true, nzo_ids: ['synthetic-queued'] }),
      )
    const first = await enqueueUsenet(followIntent(), async () => nzb)
    const second = await enqueueUsenet(
      { ...intent, titleId: 'tmdb:movie:9000002' },
      async () => nzb,
    )
    const db = getDb()
    db.update(usenetJobs)
      .set({ updatedAt: new Date(0) })
      .where(eq(usenetJobs.id, first.id))
      .run()
    request.mockImplementation((url) => {
      const mode = url.searchParams.get('mode')!
      return mode === 'queue'
        ? sabPage(mode, [
            { nzo_id: 'synthetic-queued', cat: 'torsher', status: 'Queued' },
          ])
        : sabPage(mode, [
            {
              nzo_id: 'synthetic-failed',
              category: 'torsher',
              status: 'Failed',
              loaded: false,
              fail_message:
                'Download failed - Not on your server(s) - https://sabnzbd.org/not-complete',
            },
          ])
    })
    db.run(sql`CREATE TEMP TRIGGER disconnect_after_failure AFTER UPDATE ON usenet_jobs
      WHEN NEW.problem = 'release_failed' BEGIN
        UPDATE usenet_clients SET verified = 0;
      END`)
    try {
      await expect(pollUsenet()).rejects.toThrow('not_ready')
      expect(blockedUsenetReleaseKeys(intent.titleId)).toEqual(
        new Set([intent.releaseKey]),
      )
      expect(
        db.select().from(usenetJobs).where(eq(usenetJobs.id, second.id)).get(),
      ).toMatchObject({ state: 'queued', problem: 'not_ready' })
    }
    finally {
      db.run(sql`DROP TRIGGER disconnect_after_failure`)
    }
  })
})
