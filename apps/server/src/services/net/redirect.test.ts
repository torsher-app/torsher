import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { netFetch } from './index.ts'

const fetchMock = vi.fn<typeof fetch>()

function redirect(location: string | null, status = 302) {
  return new Response(null, {
    status,
    headers: location === null ? {} : { location },
  })
}

function callUrl(index: number) {
  return String(fetchMock.mock.calls[index]![0])
}

function callInit(index: number) {
  return fetchMock.mock.calls[index]![1]!
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('netFetch redirects', () => {
  it('follows an absolute location to the final response', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://b.example/final'))
      .mockResolvedValueOnce(new Response('done'))

    const res = await netFetch('https://a.example/start')

    expect(await res.text()).toBe('done')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(callUrl(1)).toBe('https://b.example/final')
    expect(callInit(0)).toMatchObject({ redirect: 'manual' })
    expect(callInit(1)).toMatchObject({ redirect: 'manual' })
  })

  it('keeps credentials on a relative location of the same origin', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/next?page=2'))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('https://a.example/start', {
      headers: { 'X-Api-Key': 'key', 'Authorization': 'Bearer token' },
    })

    const headers = new Headers(callInit(1).headers)

    expect(callUrl(1)).toBe('https://a.example/next?page=2')
    expect(headers.get('x-api-key')).toBe('key')
    expect(headers.get('authorization')).toBe('Bearer token')
  })

  it('drops credentials when the origin changes', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://a.example:8443/next'))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('https://a.example/start', {
      headers: [
        ['X-Api-Key', 'key'],
        ['Authorization', 'Bearer token'],
        ['Cookie', 'session=1'],
        ['Proxy-Authorization', 'Basic x'],
        ['Accept', 'application/json'],
      ],
    })

    const headers = new Headers(callInit(1).headers)

    expect(headers.get('x-api-key')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('proxy-authorization')).toBeNull()
    expect(headers.get('accept')).toBe('application/json')
  })

  it('refuses a downgrade from https to http', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://a.example/plain'))

    await expect(netFetch('https://a.example/start')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a location with another scheme', async () => {
    fetchMock.mockResolvedValueOnce(redirect('file:///etc/passwd'))

    await expect(netFetch('https://a.example/start')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows up to five redirects', async () => {
    for (let hop = 1; hop <= 5; hop++)
      fetchMock.mockResolvedValueOnce(redirect(`/hop/${hop}`))

    fetchMock.mockResolvedValueOnce(new Response('done'))

    const res = await netFetch('https://a.example/start')

    expect(await res.text()).toBe('done')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('fails on the sixth redirect in a row', async () => {
    fetchMock.mockImplementation(async () => redirect('/again'))

    await expect(netFetch('https://a.example/start')).rejects.toThrow(
      'Too many redirects',
    )
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('returns a redirect status without location as is', async () => {
    fetchMock.mockResolvedValueOnce(redirect(null))

    const res = await netFetch('https://a.example/start')

    expect(res.status).toBe(302)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws on a redirect when the caller forbids them', async () => {
    fetchMock.mockResolvedValueOnce(redirect('/next'))

    await expect(
      netFetch('https://a.example/start', { redirect: 'error' }),
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(callInit(0)).toMatchObject({ redirect: 'manual' })
  })

  it('returns the redirect itself in manual mode', async () => {
    fetchMock.mockResolvedValueOnce(redirect('/next', 301))

    const res = await netFetch('https://a.example/start', {
      redirect: 'manual',
    })

    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/next')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('turns a POST into a GET without body on 303', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/result', 303))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('https://a.example/form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    })

    const init = callInit(1)

    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get('content-type')).toBeNull()
  })

  it('repeats method and body on 307', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/again', 307))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('https://a.example/form', { method: 'POST', body: 'x=1' })

    expect(callInit(1)).toMatchObject({ method: 'POST', body: 'x=1' })
  })

  it('passes the signal to every hop', async () => {
    const signal = new AbortController().signal

    fetchMock
      .mockResolvedValueOnce(redirect('/next'))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('https://a.example/start', { signal })

    expect(callInit(1).signal).toBe(signal)
  })

  it('keeps credentials on an upgrade to https on the same host', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://a.example/api', 301))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('http://a.example/api', {
      headers: { 'X-Api-Key': 'key' },
    })

    expect(new Headers(callInit(1).headers).get('x-api-key')).toBe('key')
  })

  it('drops credentials on an upgrade to https on another port', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://a.example/api', 301))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('http://a.example:9696/api', {
      headers: { 'X-Api-Key': 'key' },
    })

    expect(new Headers(callInit(1).headers).get('x-api-key')).toBeNull()
  })

  it('throws on a redirect status without location when forbidden', async () => {
    fetchMock.mockResolvedValueOnce(redirect(null, 307))

    await expect(
      netFetch('https://a.example/start', { redirect: 'error' }),
    ).rejects.toThrow()
  })

  it('keeps PUT on 302', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/again', 302))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('https://a.example/item', { method: 'PUT', body: 'x' })

    expect(callInit(1)).toMatchObject({ method: 'PUT', body: 'x' })
  })

  it('turns PUT into GET on 303', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/result', 303))
      .mockResolvedValueOnce(new Response('done'))

    await netFetch('https://a.example/item', { method: 'PUT', body: 'x' })

    expect(callInit(1).method).toBe('GET')
    expect(callInit(1).body).toBeUndefined()
  })
})
