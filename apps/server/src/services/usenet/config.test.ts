import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { usenetClients, usenetJobs } from '../../db/schema.ts'
import * as trustedHttp from '../net/trustedHttp.ts'
import { encryptSecret } from '../secrets/index.ts'
import { setSetting } from '../settings/index.ts'
import { checkUsenetConfig, readyUsenet, saveUsenetConfig } from './config.ts'
import * as paths from './paths.ts'
import { sabDeps } from './sab.ts'

beforeAll(async () => {
  await migrateDb()
})

const input = {
  url: 'https://sab.example',
  category: 'torsher',
  remoteRoot: '/completed/torsher',
  localRoot: '/usenet-inbox',
  enabled: true,
  followEnabled: true,
}

beforeEach(() => {
  getDb().delete(usenetJobs).run()
  getDb().delete(usenetClients).run()
  setSetting('usenetRestoreHold', false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('never sends a stored SAB key across a changed address class', async () => {
  const db = getDb()
  db.insert(usenetClients)
    .values({
      ...input,
      id: 'sabnzbd',
      generation: 'synthetic-generation',
      verified: true,
      encryptedApiKey: encryptSecret('synthetic-old-key'),
      lanAddresses: ['192.168.2.10'],
    })
    .run()
  const preview = vi
    .spyOn(trustedHttp, 'previewTrustedAddress')
    .mockResolvedValue({ addresses: ['192.0.2.15'], private: false })
  const request = vi
    .spyOn(sabDeps, 'request')
    .mockRejectedValue(new Error('Request stub'))
  try {
    await expect(
      checkUsenetConfig({ ...input, lanAddresses: [] }),
    ).resolves.toMatchObject({
      connection: 'address_changed',
      lanAddresses: [],
    })
    await expect(
      saveUsenetConfig({ ...input, lanAddresses: [] }),
    ).rejects.toMatchObject({ kind: 'address_changed' })
    expect(request).not.toHaveBeenCalled()

    await expect(
      checkUsenetConfig({
        ...input,
        apiKey: 'synthetic-new-key',
        lanAddresses: [],
      }),
    ).resolves.toMatchObject({ connection: 'unavailable' })
    expect(request.mock.calls[0]?.[0].searchParams.get('apikey')).toBe(
      'synthetic-new-key',
    )
  }
  finally {
    preview.mockRestore()
    request.mockRestore()
  }
})

it('keeps new submissions fenced until SAB has no unknown jobs in the dedicated category', async () => {
  setSetting('usenetRestoreHold', true)
  vi.spyOn(paths, 'canReadPinnedDirectory').mockResolvedValue(true)
  vi.spyOn(trustedHttp, 'previewTrustedAddress').mockResolvedValue({
    addresses: ['192.0.2.15'],
    private: false,
  })

  let unknownArchivedJob = true
  vi.spyOn(sabDeps, 'request').mockImplementation(async (url) => {
    const mode = url.searchParams.get('mode')!
    let result: unknown
    if (mode === 'version') {
      result = { version: '5.1.3' }
    }
    else if (mode === 'get_cats') {
      result = { categories: ['torsher'] }
    }
    else {
      const slots
        = mode === 'history'
          && url.searchParams.get('archive') === '1'
          && unknownArchivedJob
          ? [
              {
                nzo_id: 'untracked-nzo',
                category: 'torsher',
                status: 'Completed',
              },
            ]
          : []
      result = { [mode]: { slots, noofslots: slots.length } }
    }
    return {
      response: new Response(JSON.stringify(result)),
      close: async () => {},
    }
  })

  await expect(
    saveUsenetConfig({ ...input, apiKey: 'synthetic-new-key' }),
  ).resolves.toMatchObject({ verified: true, restoreBlocked: true })
  expect(readyUsenet()).toBe(false)

  unknownArchivedJob = false
  await expect(saveUsenetConfig(input)).resolves.toMatchObject({
    verified: true,
    restoreBlocked: false,
  })
  expect(readyUsenet()).toBe(true)
})
