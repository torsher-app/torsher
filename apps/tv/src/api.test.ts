import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, onProfileRequired } from './api.ts'

function respond(status: number, body: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
}

describe('api of the showcase', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    onProfileRequired(() => {})
  })

  it('reports that the server wants a profile chosen', async () => {
    const handler = vi.fn()

    onProfileRequired(handler)
    respond(403, { message: 'profile_required' })

    await expect(api.mine.getMine()).rejects.toThrow()
    expect(handler).toHaveBeenCalledOnce()
  })

  it('leaves other refusals to the screen', async () => {
    const handler = vi.fn()

    onProfileRequired(handler)
    respond(403, { message: 'Forbidden' })

    await expect(api.mine.getMine()).rejects.toThrow()
    respond(404, { message: 'profile_required' })
    await expect(api.mine.getMine()).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})
