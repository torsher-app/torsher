import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { migrateDb } from '../db/index.ts'
import {
  restartEngine,
  setEngineDown,
  setEngineReady,
} from '../services/engine/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

vi.mock('../services/engine/index.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/engine/index.ts')>()),
  restartEngine: vi.fn(() => true),
}))

const app = createApp()
let owner: Record<string, string>

function restart(cookies: Record<string, string>) {
  return app.inject({ method: 'POST', url: '/api/engine/restart', cookies })
}

beforeAll(async () => {
  await migrateDb()

  const user = createOwner({
    username: 'Owner',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
})

afterEach(() => {
  setEngineDown('stopped')
  vi.mocked(restartEngine).mockClear()
})

describe('перезапуск движка', () => {
  it('владелец перезапускает работающий движок', async () => {
    setEngineReady('http://127.0.0.1:1')

    const res = await restart(owner)

    expect(res.statusCode).toBe(202)
    expect(restartEngine).toHaveBeenCalledOnce()
  })

  it('движок, который запускается, — тот же ответ', async () => {
    setEngineDown('starting')

    expect((await restart(owner)).statusCode).toBe(202)
  })

  it('движок не установлен — 503 с причиной, перезапуска нет', async () => {
    setEngineDown('not_installed')

    const res = await restart(owner)

    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ kind: 'not_installed' })
    expect(restartEngine).not.toHaveBeenCalled()
  })

  it('без входа — 401', async () => {
    setEngineReady('http://127.0.0.1:1')

    expect((await restart({})).statusCode).toBe(401)
    expect(restartEngine).not.toHaveBeenCalled()
  })
})
