import { describe, expect, it } from 'vitest'
import {
  DemoError,
  get,
  handle,
  NO_CONTENT,
  post,
  unavailable,
} from './router.ts'

get<{ id: string }>('/api/test/items/:id', ({ params }) => ({
  id: params.id!,
}))
post('/api/test/empty', () => NO_CONTENT)
post('/api/test/conflict', () => {
  throw new DemoError(409, { kind: 'duplicate' })
})
post('/api/test/unavailable', () => unavailable())

const MESSAGE = 'Not available in the demo'

function request(path: string, method = 'GET') {
  return handle(new URL(`http://demo${path}`), { method }, MESSAGE)
}

describe('demo router', () => {
  it('passes path params to the handler', async () => {
    const response = await request('/api/test/items/a%20b')

    expect(await response.json()).toEqual({ id: 'a b' })
  })

  it('answers an empty result with 204', async () => {
    expect((await request('/api/test/empty', 'POST')).status).toBe(204)
  })

  it('keeps the error body next to the message', async () => {
    const response = await request('/api/test/conflict', 'POST')

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      message: MESSAGE,
      kind: 'duplicate',
    })
  })

  it('answers unavailable actions and unknown paths with 501', async () => {
    for (const response of [
      await request('/api/test/unavailable', 'POST'),
      await request('/api/nowhere'),
    ]) {
      expect(response.status).toBe(501)
      expect(await response.json()).toEqual({ message: MESSAGE })
    }
  })
})
