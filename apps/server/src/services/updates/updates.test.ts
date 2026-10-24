import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import { serverSettings, serverVersions } from '../../db/schema.ts'
import { createOwner } from '../users/index.ts'
import { signToken } from '../../utils/token.ts'
import { githubRepoOf } from './github.ts'
import {
  checkForUpdates,
  checkForUpdatesNow,
  dismissUpdate,
  isUpdateCheckDue,
  latestRelease,
  onUpdateFound,
  readUpdateState,
  recordServerVersion,
  saveUpdateSettings,
  updateStatus,
} from './index.ts'
import { releaseHighlights } from './notes.ts'
import { compareVersions, isNewerVersion, parseVersion } from './version.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
let owner: Record<string, string>

function release(tag: string, values: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/torsher-app/torsher/releases/tag/${tag}`,
    draft: false,
    prerelease: tag.includes('-'),
    published_at: '2026-10-20T10:00:00Z',
    body: `## Features\n\n- Added ${tag}\n`,
    ...values,
  }
}

function respond(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { etag: '"r1"', ...init.headers },
    ...init,
  })
}

beforeAll(async () => {
  await migrateDb()

  const user = createOwner({
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
})

beforeEach(() => {
  getDb().delete(serverSettings).run()
  getDb().delete(serverVersions).run()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TORSHER_VERSION', '0.3.0')
  vi.stubEnv('TORSHER_SOURCE_URL', '')
  onUpdateFound(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('version', () => {
  it('сравнивает по старшинству semver', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.10.0',
      '2.0.0',
    ]

    for (let i = 1; i < ordered.length; i++) {
      const lower = parseVersion(ordered[i - 1]!)!
      const higher = parseVersion(ordered[i]!)!

      expect(compareVersions(lower, higher)).toBe(-1)
      expect(compareVersions(higher, lower)).toBe(1)
    }

    expect(
      compareVersions(parseVersion('v1.2.3+build.5')!, parseVersion('1.2.3')!),
    ).toBe(0)
  })

  it('пререлиз не новее своего релиза', () => {
    expect(isNewerVersion('1.0.0-rc.1', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.1-beta.1', '1.0.0')).toBe(true)
  })

  it('не считает версией чужие теги', () => {
    expect(parseVersion('latest')).toBeUndefined()
    expect(parseVersion('0.3')).toBeUndefined()
    expect(parseVersion('@torsher/server@0.3.0')).toBeUndefined()
    expect(parseVersion('01.2.3')).toBeUndefined()
  })
})

describe('releaseHighlights', () => {
  it('берёт пункты верхнего уровня без разметки', () => {
    const body = [
      '## What changed',
      '',
      'Intro paragraph.',
      '- **Panel:** new [notifications](https://example.com) center (abc1234)',
      '  - nested detail',
      '* `docker compose pull` hint (#42)',
      '+ <b>html</b> stripped',
    ].join('\n')

    expect(releaseHighlights(body)).toEqual([
      'Panel: new notifications center',
      'docker compose pull hint',
      'html stripped',
    ])
  })

  it('держит не больше восьми коротких пунктов', () => {
    const body = Array.from(
      { length: 12 },
      (_, i) => `- item ${i} ${'x'.repeat(300)}`,
    ).join('\n')
    const items = releaseHighlights(body)

    expect(items).toHaveLength(8)
    expect(items[0]).toHaveLength(200)
    expect(items[0]!.endsWith('…')).toBe(true)
  })
})

describe('latestRelease', () => {
  const releases = [
    release('v0.4.0-beta.1'),
    release('v0.3.1'),
    release('v0.5.0', { draft: true }),
    release('nightly'),
    release('v0.2.0'),
  ].map(raw => ({
    tagName: raw.tag_name,
    url: raw.html_url,
    draft: raw.draft,
    prerelease: raw.prerelease,
    body: raw.body,
    publishedAt: raw.published_at,
  }))

  it('stable пропускает пререлизы, черновики и чужие теги', () => {
    expect(latestRelease(releases, false)?.version).toBe('0.3.1')
  })

  it('beta берёт и пререлизы', () => {
    expect(latestRelease(releases, true)).toMatchObject({
      version: '0.4.0-beta.1',
      prerelease: true,
      notes: ['Added v0.4.0-beta.1'],
    })
  })
})

describe('githubRepoOf', () => {
  it('понимает только репозиторий на GitHub', () => {
    expect(githubRepoOf('https://github.com/torsher-app/torsher')).toEqual({
      owner: 'torsher-app',
      repo: 'torsher',
    })
    expect(githubRepoOf('https://github.com/fork/torsher.git/')).toEqual({
      owner: 'fork',
      repo: 'torsher',
    })
    expect(githubRepoOf('https://git.example.com/a/b')).toBeUndefined()
    expect(githubRepoOf('https://github.com/only-owner')).toBeUndefined()
  })
})

describe('checkForUpdates', () => {
  it('ходит в релизы репозитория без авторизации и находит новую версию', async () => {
    const found = vi.fn()

    onUpdateFound(found)
    fetchMock.mockResolvedValue(
      respond([release('v0.4.0'), release('v0.3.0')]),
    )

    await checkForUpdates()

    const [url, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)

    expect(String(url)).toBe(
      'https://api.github.com/repos/torsher-app/torsher/releases?per_page=20',
    )
    expect(headers.get('user-agent')).toBe('Torsher/0.3.0')
    expect(headers.has('authorization')).toBe(false)
    expect(updateStatus()).toMatchObject({
      state: 'available',
      latest: { version: '0.4.0' },
    })
    expect(found).toHaveBeenCalledTimes(1)

    // О той же версии второй раз не сообщает
    await checkForUpdates()
    expect(found).toHaveBeenCalledTimes(1)
  })

  it('повторяет условным запросом и переживает 304', async () => {
    fetchMock.mockResolvedValueOnce(respond([release('v0.3.0')]))
    await checkForUpdates()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }))
    await checkForUpdates()

    const headers = new Headers(fetchMock.mock.calls[1]![1]?.headers)

    expect(headers.get('if-none-match')).toBe('"r1"')
    expect(updateStatus()).toMatchObject({ state: 'current' })
    expect(readUpdateState().stable?.version).toBe('0.3.0')
  })

  it('после лимита GitHub ждёт сброса', async () => {
    const reset = Math.floor(Date.now() / 1000) + 1800

    fetchMock.mockResolvedValue(
      new Response('{}', {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(reset),
        },
      }),
    )

    await checkForUpdates()

    expect(updateStatus()).toMatchObject({
      state: 'error',
      error: { kind: 'rate_limited' },
    })
    expect(isUpdateCheckDue()).toBe(false)
    expect(isUpdateCheckDue(reset * 1000 + 1)).toBe(true)
  })

  it('недоступный GitHub — ошибка, повтор через час', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await checkForUpdates()

    expect(updateStatus()).toMatchObject({
      state: 'error',
      error: { kind: 'unavailable' },
    })
    expect(isUpdateCheckDue()).toBe(false)
    expect(isUpdateCheckDue(Date.now() + 61 * 60 * 1000)).toBe(true)
  })

  it('закрытый репозиторий — not_found, повтор через сутки', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }))

    await checkForUpdates()

    expect(updateStatus()).toMatchObject({
      state: 'error',
      error: { kind: 'not_found' },
    })
    expect(isUpdateCheckDue(Date.now() + 2 * 60 * 60 * 1000)).toBe(false)
    expect(isUpdateCheckDue(Date.now() + 25 * 60 * 60 * 1000)).toBe(true)
  })

  it('канал beta видит пререлиз без нового запроса', async () => {
    fetchMock.mockResolvedValue(
      respond([release('v0.4.0-beta.1'), release('v0.3.0')]),
    )
    await checkForUpdates()

    expect(updateStatus().state).toBe('current')

    saveUpdateSettings({ enabled: true, channel: 'beta' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(updateStatus()).toMatchObject({
      state: 'available',
      channel: 'beta',
      latest: { version: '0.4.0-beta.1' },
    })
  })
})

describe('checkForUpdates и правки во время запроса', () => {
  it('скрытая во время проверки карточка не возвращается', async () => {
    let answer: (response: Response) => void = () => {}

    fetchMock.mockResolvedValueOnce(respond([release('v0.4.0')]))
    await checkForUpdates()

    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    // Сутки прошли: проверка снова идёт в GitHub
    const checking = checkForUpdates()

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    dismissUpdate('0.4.0')
    answer(respond([release('v0.4.0')]))
    await checking

    expect(readUpdateState()).toMatchObject({
      dismissedVersion: '0.4.0',
      notifiedVersion: '0.4.0',
      stable: { version: '0.4.0' },
    })
  })

  it('«Проверить сейчас» не ходит в сеть без проверки или без релиза', async () => {
    saveUpdateSettings({ enabled: false, channel: 'stable' })
    await checkForUpdatesNow()
    await checkForUpdates()

    vi.stubEnv('TORSHER_VERSION', '')
    saveUpdateSettings({ enabled: true, channel: 'stable' })
    await checkForUpdatesNow()
    await checkForUpdates()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('updateStatus', () => {
  it('сборка без версии релиза не проверяет', () => {
    vi.stubEnv('TORSHER_VERSION', '')

    expect(updateStatus().state).toBe('dev')
    expect(isUpdateCheckDue()).toBe(false)
  })

  it('исходники не на GitHub — проверка недоступна', () => {
    vi.stubEnv('TORSHER_SOURCE_URL', 'https://git.example.com/fork/torsher')

    expect(updateStatus().state).toBe('unsupported')
    expect(isUpdateCheckDue()).toBe(false)
  })

  it('выключенная проверка не ходит в сеть', () => {
    saveUpdateSettings({ enabled: false, channel: 'stable' })

    expect(updateStatus().state).toBe('off')
    expect(isUpdateCheckDue()).toBe(false)
  })
})

describe('recordServerVersion', () => {
  it('сообщает прежнюю версию только при смене', () => {
    expect(recordServerVersion()).toBeUndefined()
    expect(recordServerVersion()).toBeUndefined()

    vi.stubEnv('TORSHER_VERSION', '0.4.0')

    expect(recordServerVersion()).toBe('0.3.0')
    expect(getDb().select().from(serverVersions).all()).toHaveLength(2)
  })
})

describe('routes /api/updates', () => {
  it('только для владельца', async () => {
    const res = await app.inject({ url: '/api/updates' })

    expect(res.statusCode).toBe(401)
  })

  it('сохраняет настройки, проверяет и скрывает карточку «Обзора»', async () => {
    fetchMock.mockResolvedValue(respond([release('v0.4.0')]))

    const checked = await app.inject({
      method: 'POST',
      url: '/api/updates/check',
      cookies: owner,
    })

    expect(checked.json()).toMatchObject({
      state: 'available',
      current: { version: '0.3.0' },
      latest: { version: '0.4.0', notes: ['Added v0.4.0'] },
    })

    // Повтор в ту же минуту в GitHub не ходит
    await app.inject({
      method: 'POST',
      url: '/api/updates/check',
      cookies: owner,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const settings = await app.inject({
      method: 'PUT',
      url: '/api/updates/settings',
      cookies: owner,
      payload: { enabled: false, channel: 'stable' },
    })

    expect(settings.json()).toMatchObject({ enabled: false, state: 'off' })

    saveUpdateSettings({ enabled: true, channel: 'stable' })

    const dismissed = await app.inject({
      method: 'POST',
      url: '/api/updates/dismiss',
      cookies: owner,
      payload: { version: '0.4.0' },
    })

    expect(dismissed.statusCode).toBe(204)
    expect(readUpdateState().dismissedVersion).toBe('0.4.0')
  })
})
