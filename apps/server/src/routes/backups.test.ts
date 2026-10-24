import type { FastifyInstance } from 'fastify'
import { Buffer } from 'node:buffer'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// config читает DATABASE_PATH при импорте: модули — после подмены окружения.
// Копии снимаются только с файловой базы
let dataDir: string
let downloads: string
let source: string
let app: FastifyInstance
let owner: Record<string, string>
let plainBackup: { name: string, data: Buffer }
let lockedBackup: { name: string, data: Buffer }
let backups: typeof import('../services/backups/index.ts')
let state: typeof import('../services/backups/state.ts')
const restart = vi.fn()

const PASSWORD = 'backup-password'
// Загруженная копия прежней установки: без входа её не трогают
const OLD_UPLOAD = 'torsher-backup-20200101T000000Z-uploaded-v0.1.0.db.gz'

function signupRequest() {
  return app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      name: 'Owner',
      email: 'owner@example.com',
      password: 'owner-password',
    },
  })
}

async function makeBackup(keyMaterial?: unknown) {
  const fixtures = await import('../services/backups/fixtures/index.ts')
  const { createBackup } = await import('../services/backups/create.ts')
  const dir = fixtures.tempDataDir()
  const { db, dbPath } = fixtures.createFileDb(dir)

  fixtures.seedData(db)
  db.close()

  const created = await createBackup({
    dbPath,
    tmpDir: join(dir, 'backups-tmp'),
    dir: source,
    reason: 'scheduled',
    version: '0.9.0',
    secretKey: Buffer.alloc(32, 9),
    keyMaterial: keyMaterial as never,
  })

  const data = readFileSync(join(source, created.name))

  rmSync(dir, { recursive: true, force: true })

  return { name: created.name, data }
}

function upload(
  payload: Buffer | Readable,
  options: { name?: string, cookies?: Record<string, string> } = {},
) {
  return app.inject({
    method: 'POST',
    url: `/api/backups/upload${options.name ? `?name=${encodeURIComponent(options.name)}` : ''}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload,
    cookies: options.cookies,
  })
}

function resetRestore() {
  state.runtime.restore = undefined
  rmSync(join(dataDir, 'restore.json'), { force: true })
  rmSync(join(dataDir, 'restore-pending.db'), { force: true })
  rmSync(join(dataDir, 'restore-pending.key'), { force: true })
}

function backupFiles() {
  return readdirSync(join(dataDir, 'backups'))
}

function tmpFiles() {
  return existsSync(join(dataDir, 'backups-tmp'))
    ? readdirSync(join(dataDir, 'backups-tmp'))
    : []
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'torsher-backup-routes-'))
  downloads = join(dataDir, 'downloads')
  source = join(dataDir, 'source')
  mkdirSync(downloads)
  mkdirSync(source)
  vi.stubEnv('DATABASE_PATH', join(dataDir, 'torsher.db'))
  vi.stubEnv('DOWNLOADS_PATH', downloads)
  vi.resetModules()

  const db = await import('../db/index.ts')

  await db.migrateDb()
  backups = await import('../services/backups/index.ts')
  state = await import('../services/backups/state.ts')

  const { onRestartRequested } = await import('../services/lifecycle.ts')
  const { deriveKeyMaterial } = await import('../services/backups/crypto.ts')
  const { createApp } = await import('../app.ts')

  onRestartRequested(restart)
  plainBackup = await makeBackup()
  mkdirSync(join(dataDir, 'backups'), { recursive: true })
  writeFileSync(join(dataDir, 'backups', OLD_UPLOAD), plainBackup.data)
  lockedBackup = await makeBackup(await deriveKeyMaterial(PASSWORD))
  app = createApp()
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  vi.unstubAllEnvs()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('пустой сервер: восстановление без входа', () => {
  let uploaded: string

  it('загрузка без входа сохраняет копию с временем и версией из имени', async () => {
    const res = await upload(plainBackup.data, { name: plainBackup.name })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      reason: 'uploaded',
      version: '0.9.0',
      encrypted: false,
      dirKind: 'main',
      size: plainBackup.data.length,
    })
    uploaded = res.json().name
    // Без входа копия остаётся во временном каталоге, а не в каталоге копий
    expect(tmpFiles()).toContain(uploaded)
    expect(backupFiles()).not.toContain(uploaded)
  })

  it('новая загрузка без входа заменяет прежнюю; дата из будущего — время загрузки', async () => {
    const future = 'torsher-backup-29990101T000000Z-manual-v1.0.0.db.gz'
    const res = await upload(plainBackup.data, { name: future })

    expect(res.statusCode).toBe(201)
    expect(Date.parse(res.json().createdAt)).toBeLessThanOrEqual(Date.now())
    expect(res.json().version).toBe('1.0.0')
    expect(tmpFiles().filter(name => name.includes('-uploaded-'))).toEqual([
      res.json().name,
    ])
    expect(backupFiles().filter(name => name.includes('-uploaded-'))).toEqual(
      [OLD_UPLOAD],
    )
    uploaded = res.json().name
  })

  it('без входа восстанавливается только загруженная без входа копия', async () => {
    for (const name of [plainBackup.name, OLD_UPLOAD]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/backups/${name}/restore`,
      })

      expect(res.statusCode, name).toBe(404)
    }
  })

  it('восстановление загруженной: 202, проверка в фоне и перезапуск', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/${uploaded}/restore`,
    })

    expect(res.statusCode).toBe(202)
    expect(res.json().restore).toMatchObject({
      state: 'checking',
      backup: uploaded,
    })

    await vi.waitFor(() => expect(restart).toHaveBeenCalledWith('restore'), {
      timeout: 10_000,
    })
    // Ждёт перезапуска — аккаунт не создаётся
    expect((await signupRequest()).statusCode).toBe(409)

    const status = await app.inject({ url: '/api/backups/restore' })

    expect(status.statusCode).toBe(200)
    expect(status.json().restore).toMatchObject({ state: 'pending' })
    // Копии пустой базы перед восстановлением нет: сохранять нечего
    expect(backupFiles().some(name => name.includes('-pre-restore-'))).toBe(
      false,
    )
    resetRestore()
  })

  it('аккаунт создан, пока копия проверялась, — восстановление отменено', async () => {
    const { createOwner } = await import('../services/users/index.ts')
    const { signToken } = await import('../utils/token.ts')
    const { ACCESS_TOKEN_COOKIE } = await import('../config.ts')

    const { restoreRequestDeps }
      = await import('../services/backups/restore-request.ts')
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => (enter = resolve))
    const released = new Promise<void>(resolve => (release = resolve))

    // Подготовка останавливается перед последней проверкой аккаунта
    restoreRequestDeps.checkpoint = async () => {
      enter()
      await released
    }
    restart.mockClear()

    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/backups/${uploaded}/restore`,
      })

      expect(res.statusCode).toBe(202)
      await entered
      // Проверка идёт — аккаунт через signup не создаётся
      expect((await signupRequest()).statusCode).toBe(409)

      // Аккаунт в обход signup, пока подготовка стоит
      const user = createOwner({
        name: 'Owner',
        email: 'owner@example.com',
        passwordHash: 'x',
      })

      owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
      release()
    }
    finally {
      restoreRequestDeps.checkpoint = async () => {}
    }

    await vi.waitFor(
      async () => {
        const status = await app.inject({
          url: '/api/backups/restore',
          cookies: owner,
        })

        expect(status.json().restore).toMatchObject({
          state: 'failed',
          reason: 'account_created',
        })
      },
      { timeout: 10_000 },
    )
    expect(restart).not.toHaveBeenCalled()
    expect(existsSync(join(dataDir, 'restore-pending.db'))).toBe(false)
    expect(existsSync(join(dataDir, 'restore.json'))).toBe(false)
    resetRestore()
  })

  it('после создания аккаунта загрузка и восстановление — только владельцу', async () => {
    expect((await upload(plainBackup.data)).statusCode).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/backups/${uploaded}/restore`,
        })
      ).statusCode,
    ).toBe(401)
    expect((await app.inject({ url: '/api/backups/restore' })).statusCode).toBe(
      401,
    )
  })

  it('после перезапуска загруженной без входа копии нет нигде', async () => {
    await backups.cleanupBackupTempNow()

    expect(tmpFiles()).toEqual([])
    expect(backupFiles().filter(name => name.includes('-uploaded-'))).toEqual(
      [OLD_UPLOAD],
    )
  })
})

describe('настройки', () => {
  function put(body: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: '/api/backups/settings',
      cookies: owner,
      payload: {
        enabled: true,
        time: '04:00',
        keepDaily: 7,
        keepWeekly: 4,
        ...body,
      },
    })
  }

  it('правила DTO: время, число ежедневных и еженедельных', async () => {
    expect((await put({ time: '24:00' })).statusCode).toBe(400)
    expect((await put({ keepDaily: 0 })).statusCode).toBe(400)
    expect((await put({ keepWeekly: 13 })).statusCode).toBe(400)

    const res = await put({ time: '03:30', keepDaily: 10, keepWeekly: 0 })

    // Загруженная копия — не копия этого сервера
    expect(res.json().state.lastSuccessAt).toBeUndefined()

    expect(res.statusCode).toBe(200)
    expect(res.json().settings).toMatchObject({
      enabled: true,
      time: '03:30',
      keepDaily: 10,
      keepWeekly: 0,
      mode: 'key',
    })
    expect(res.json().state.timezone).toEqual(expect.any(String))
  })

  it('каталог внутри загрузок — 422 с полем', async () => {
    const inside = join(downloads, 'backups')

    mkdirSync(inside)

    const res = await put({ dir: inside })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({
      kind: 'overlaps_storage',
      field: 'dir',
    })

    const check = await app.inject({
      method: 'POST',
      url: '/api/backups/check',
      cookies: owner,
      payload: { path: inside },
    })

    expect(check.json()).toMatchObject({ problem: 'overlaps_storage' })
  })

  it('свой каталог, затем снова по умолчанию', async () => {
    const own = join(dataDir, 'nas')

    mkdirSync(own)

    const chosen = await put({ dir: own })

    expect(chosen.statusCode).toBe(200)
    expect(chosen.json().dir).toMatchObject({
      path: own,
      source: 'panel',
      available: true,
    })

    const reset = await put({ dir: null })

    expect(reset.json().dir).toMatchObject({
      path: join(dataDir, 'backups'),
      source: 'default',
    })
  })

  it('каталог пропал (диск не смонтирован) — available: false', async () => {
    backups.saveBackupSettings({ dir: join(dataDir, 'unmounted') })

    const res = await app.inject({ url: '/api/backups', cookies: owner })

    expect(res.json().dir).toMatchObject({ available: false })
    backups.saveBackupSettings({ dir: null })
  })

  it('пароль копий: только на запись, в ответе его нет', async () => {
    const short = await app.inject({
      method: 'PUT',
      url: '/api/backups/encryption',
      cookies: owner,
      payload: { mode: 'password', password: 'short' },
    })

    expect(short.statusCode).toBe(400)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/backups/encryption',
      cookies: owner,
      payload: { mode: 'password', password: PASSWORD },
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain(PASSWORD)
    expect(res.json().settings).toMatchObject({
      mode: 'password',
      passwordSetAt: expect.any(String),
    })

    const off = await app.inject({
      method: 'PUT',
      url: '/api/backups/encryption',
      cookies: owner,
      payload: { mode: 'key' },
    })

    expect(off.json().settings.mode).toBe('key')
    expect(off.json().settings.passwordSetAt).toBeUndefined()
  })
})

describe('копии', () => {
  it('ручная копия: 202, снимок в фоне и строка в списке', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups',
      cookies: owner,
    })

    expect(res.statusCode).toBe(202)
    await vi.waitFor(
      async () => {
        const status = await app.inject({
          url: '/api/backups',
          cookies: owner,
        })

        expect(status.json().state.running).toBeUndefined()
        expect(
          status
            .json()
            .items.some((item: { reason: string }) => item.reason === 'manual'),
        ).toBe(true)
      },
      { timeout: 10_000 },
    )
  })

  it('«Обзор» и страница копий считают последнюю копию одинаково: состояние и файлы', async () => {
    // После восстановления состояние в базе старше файлов
    state.updateBackupState({ lastSuccessAt: '2020-01-01T00:00:00.000Z' })

    const status = await app.inject({ url: '/api/backups', cookies: owner })
    const overview = await app.inject({ url: '/api/overview', cookies: owner })
    const last = status.json().state.lastSuccessAt

    expect(last).not.toBe('2020-01-01T00:00:00.000Z')
    expect(overview.json().backups.lastSuccessAt).toBe(last)
  })

  it('скачать: по имени копии — файл, чужое имя и выход из каталога — 404', async () => {
    const [name] = backupFiles().filter(item => item.includes('-uploaded-'))
    const res = await app.inject({
      url: `/api/backups/${name}/download`,
      cookies: owner,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="${name}"`,
    )
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.rawPayload.equals(plainBackup.data)).toBe(true)

    for (const bad of ['torsher.db', '..%2Fsecret.key', `..%2F${name}`]) {
      const missing = await app.inject({
        url: `/api/backups/${bad}/download`,
        cookies: owner,
      })

      expect(missing.statusCode, bad).toBe(404)
    }
  })

  it('загрузка сверх предела — 413, файла не остаётся', async () => {
    const before = backupFiles()

    backups.uploadLimits.maxBytes = 16

    try {
      const declared = await upload(plainBackup.data, { cookies: owner })

      expect(declared.statusCode).toBe(413)
      expect(declared.json().kind).toBe('too_large')

      // Без Content-Length предел считает поток
      const streamed = await upload(Readable.from([plainBackup.data]), {
        cookies: owner,
      })

      expect(streamed.statusCode).toBe(413)
    }
    finally {
      backups.uploadLimits.maxBytes = 2 * 1024 ** 3
    }

    expect(backupFiles()).toEqual(before)
    expect(
      existsSync(join(dataDir, 'backups-tmp'))
        ? readdirSync(join(dataDir, 'backups-tmp'))
        : [],
    ).toEqual([])
  })

  it('одна загрузка за раз — вторая получает busy', async () => {
    const { PassThrough } = await import('node:stream')
    const body = new PassThrough()
    // Первая ждёт конца тела: так вторая приходит, пока первая идёт
    const first = backups.uploadBackup(body, {})

    body.write(plainBackup.data.subarray(0, 10))

    const second = await upload(plainBackup.data, { cookies: owner })

    expect(second.statusCode).toBe(422)
    expect(second.json().kind).toBe('busy')
    body.end(plainBackup.data.subarray(10))
    await expect(first).resolves.toMatchObject({ reason: 'uploaded' })
  })

  it('места меньше, чем объявленный размер, — 422 no_space до приёма', async () => {
    const { backupDeps } = await import('../services/backups/space.ts')
    const before = backupFiles()

    vi.spyOn(backupDeps, 'diskUsage').mockResolvedValue({
      free: 1024,
      total: 2048,
    } as never)

    try {
      const res = await upload(plainBackup.data, { cookies: owner })

      expect(res.statusCode).toBe(422)
      expect(res.json()).toMatchObject({
        kind: 'no_space',
        params: { free: 1024 },
      })
    }
    finally {
      vi.restoreAllMocks()
    }

    expect(backupFiles()).toEqual(before)
  })

  it('нет данных дольше предела простоя — загрузка оборвана, слот свободен', async () => {
    const { PassThrough } = await import('node:stream')
    const body = new PassThrough()

    backups.uploadLimits.idleMs = 50

    try {
      const stalled = backups.uploadBackup(body, {})

      body.write(plainBackup.data.subarray(0, 10))
      await expect(stalled).rejects.toMatchObject({
        kind: 'io',
        params: { code: 'UPLOAD_IDLE_TIMEOUT' },
      })
    }
    finally {
      backups.uploadLimits.idleMs = 30_000
    }

    expect(readdirSync(join(dataDir, 'backups-tmp'))).toEqual([])
    expect(
      (await upload(plainBackup.data, { cookies: owner })).statusCode,
    ).toBe(201)
  })

  it('не архив — 422 not_torsher', async () => {
    const res = await upload(Buffer.from('SQLite format 3\0 and more'), {
      cookies: owner,
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('not_torsher')
  })

  it('удаление: своя — 204, чужое имя — 404', async () => {
    const res = await upload(plainBackup.data, { cookies: owner })
    const { name } = res.json()

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/backups/${name}`,
          cookies: owner,
        })
      ).statusCode,
    ).toBe(204)
    expect(backupFiles()).not.toContain(name)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/backups/torsher.db',
          cookies: owner,
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('восстановление владельцем', () => {
  it('нет такой копии — 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/torsher-backup-20200101T000000Z-manual-v1.0.0.db.gz/restore',
      cookies: owner,
    })

    expect(res.statusCode).toBe(404)
  })

  it('копия под паролем: неверный пароль — 422 wrong_password', async () => {
    const res = await upload(lockedBackup.data, { cookies: owner })

    expect(res.json().encrypted).toBe(true)

    const restore = await app.inject({
      method: 'POST',
      url: `/api/backups/${res.json().name}/restore`,
      cookies: owner,
      payload: { password: 'not-the-password' },
    })

    expect(restore.statusCode).toBe(422)
    expect(restore.json().kind).toBe('wrong_password')
  })

  it('верный пароль — 202, копия текущей базы и перезапуск', async () => {
    restart.mockClear()

    const [name] = backupFiles().filter(item => item.endsWith('.enc'))
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/${name}/restore`,
      cookies: owner,
      payload: { password: PASSWORD },
    })

    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(restart).toHaveBeenCalledWith('restore'), {
      timeout: 10_000,
    })
    expect(backupFiles().some(item => item.includes('-pre-restore-'))).toBe(
      true,
    )

    const busy = await app.inject({
      method: 'POST',
      url: `/api/backups/${name}/restore`,
      cookies: owner,
      payload: { password: PASSWORD },
    })

    expect(busy.statusCode).toBe(422)
    expect(busy.json().kind).toBe('busy')
    resetRestore()
  })
})
