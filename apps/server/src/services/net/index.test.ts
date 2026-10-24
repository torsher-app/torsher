import type { AddressInfo, Server } from 'node:net'
import { Buffer } from 'node:buffer'
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http'
import { connect, createServer as createTcpServer } from 'node:net'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { migrateDb } from '../../db/index.ts'
import { setDohSend } from './doh.ts'
import { dnsAnswer, queryFromUrl, queryType } from './fixtures/dnsMessage.ts'
import {
  createRoute,
  deleteRoute,
  listRoutes,
  netFetch,
  routesChanged,
  setNetTransport,
} from './index.ts'

function listen(server: Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port))
  })
}

function close(server: Server) {
  return new Promise(resolve => server.close(resolve))
}

// Цель запросов: отвечает хостом, который пришёл в запросе
const target = createHttpServer((req, res) => {
  res.end(`hello ${req.headers.host}`)
})

interface SocksLog {
  requested: string[]
  credentials: string[]
}

/** SOCKS5 с CONNECT по доменному имени: так видно, что имя разрешает прокси */
function socksServer(log: SocksLog, auth?: { user: string, pass: string }) {
  return createTcpServer((socket) => {
    const tunnel = () => {
      socket.once('data', (request) => {
        const type = request[3]
        let host = ''
        let offset = 4

        if (type === 3) {
          host = request.subarray(5, 5 + request[4]!).toString()
          offset = 5 + request[4]!
        }
        else {
          host = [...request.subarray(4, 8)].join('.')
          offset = 8
        }

        const port = request.readUInt16BE(offset)

        log.requested.push(`${host}:${port}`)

        const upstream = connect(port, '127.0.0.1', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          upstream.pipe(socket)
          socket.pipe(upstream)
        })

        upstream.on('error', () => socket.destroy())
      })
    }

    socket.once('data', () => {
      if (!auth) {
        socket.write(Buffer.from([5, 0]))
        tunnel()
        return
      }

      socket.write(Buffer.from([5, 2]))
      socket.once('data', (creds) => {
        const userLength = creds[1]!
        const user = creds.subarray(2, 2 + userLength).toString()
        const pass = creds
          .subarray(3 + userLength, 3 + userLength + creds[2 + userLength]!)
          .toString()
        const ok = user === auth.user && pass === auth.pass

        log.credentials.push(`${user}:${pass}`)
        socket.write(Buffer.from([1, ok ? 0 : 1]))

        if (ok)
          tunnel()
        else socket.end()
      })
    })
    socket.on('error', () => {})
  })
}

interface ProxyLog {
  urls: string[]
  authorization: (string | undefined)[]
}

/** HTTP-прокси с пересылкой абсолютного адреса на локальную цель */
function httpProxy(log: ProxyLog) {
  return createHttpServer((req, res) => {
    const url = new URL(req.url!)

    log.urls.push(url.href)
    log.authorization.push(req.headers['proxy-authorization'])

    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: url.port,
        path: url.pathname,
        headers: { host: url.host },
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      },
    )

    upstream.end()
  })
}

const socksLog: SocksLog = { requested: [], credentials: [] }
const proxyLog: ProxyLog = { urls: [], authorization: [] }
const socks = socksServer(socksLog)
const socksWithAuth = socksServer(socksLog, { user: 'reader', pass: 's3cret' })
const proxy = httpProxy(proxyLog)
let targetPort = 0
let socksPort = 0
let socksAuthPort = 0
let proxyPort = 0

beforeAll(async () => {
  await migrateDb()
  setNetTransport(null);
  [targetPort, socksPort, socksAuthPort, proxyPort] = await Promise.all([
    listen(target),
    listen(socks),
    listen(socksWithAuth),
    listen(proxy),
  ])
})

beforeEach(() => {
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
    vi.stubEnv(name, '')

  for (const route of listRoutes()) {
    if (route.match !== '*')
      deleteRoute(route.id)
  }

  routesChanged()
  socksLog.requested.length = 0
  socksLog.credentials.length = 0
  proxyLog.urls.length = 0
  proxyLog.authorization.length = 0
})

afterAll(async () => {
  setNetTransport((url, init) => globalThis.fetch(url, init))
  setDohSend(null)
  routesChanged()
  await Promise.all([
    close(target),
    close(socks),
    close(socksWithAuth),
    close(proxy),
  ])
})

describe('netFetch', () => {
  it('goes direct by the default route', async () => {
    const res = await netFetch(`http://127.0.0.1:${targetPort}/`)

    expect(await res.text()).toBe(`hello 127.0.0.1:${targetPort}`)
  })

  it('tunnels through socks5 and lets the proxy resolve the name', async () => {
    createRoute({
      match: '*.socks.test',
      via: 'socks5h',
      proxy: `127.0.0.1:${socksPort}`,
      dns: 'system',
    })
    routesChanged()

    // Имя `.test` не разрешается локально: ответ возможен, только если имя ушло прокси
    const res = await netFetch(`http://api.socks.test:${targetPort}/`)

    expect(await res.text()).toBe(`hello api.socks.test:${targetPort}`)
    expect(socksLog.requested).toEqual([`api.socks.test:${targetPort}`])
  })

  it('sends socks5 credentials from the route', async () => {
    createRoute({
      match: 'auth.socks.test',
      via: 'socks5h',
      proxy: `socks5://reader:s3cret@127.0.0.1:${socksAuthPort}`,
      dns: 'system',
    })
    routesChanged()

    const res = await netFetch(`http://auth.socks.test:${targetPort}/`)

    expect(res.status).toBe(200)
    expect(socksLog.credentials).toEqual(['reader:s3cret'])
  })

  it('forwards through an http proxy with basic auth', async () => {
    createRoute({
      match: 'indexer.test',
      via: 'http',
      proxy: `127.0.0.1:${proxyPort}`,
      username: 'reader',
      password: 's3cret',
      dns: 'system',
    })
    routesChanged()

    const res = await netFetch(`http://indexer.test:${targetPort}/api`)

    expect(await res.text()).toBe(`hello indexer.test:${targetPort}`)
    expect(proxyLog.urls).toEqual([`http://indexer.test:${targetPort}/api`])
    expect(proxyLog.authorization).toEqual([
      `Basic ${Buffer.from('reader:s3cret').toString('base64')}`,
    ])
  })

  it('resolves hosts of a route through doh instead of the system dns', async () => {
    setDohSend(async (url) => {
      const query = queryFromUrl(url)
      const records = queryType(query) === 1 ? [{ address: '127.0.0.1' }] : []

      return new Response(new Uint8Array(dnsAnswer(query, records)))
    })
    createRoute({
      match: '*.doh.test',
      via: 'direct',
      dns: 'custom',
      dohUrl: 'https://doh.example/dns-query',
    })
    routesChanged()

    const res = await netFetch(`http://site.doh.test:${targetPort}/`)

    expect(await res.text()).toBe(`hello site.doh.test:${targetPort}`)
    // Хост вне маршрута идёт через системный DNS и `.test` не находит
    await expect(
      netFetch(`http://site.other.test:${targetPort}/`),
    ).rejects.toThrow()
  })

  it('sends the default route through the proxy from the environment', async () => {
    vi.stubEnv('http_proxy', `http://127.0.0.1:${proxyPort}`)
    vi.stubEnv('no_proxy', '')
    vi.stubEnv('NO_PROXY', '')
    routesChanged()

    try {
      const res = await netFetch(`http://env.proxy.test:${targetPort}/`)

      expect(await res.text()).toBe(`hello env.proxy.test:${targetPort}`)
      expect(proxyLog.urls).toEqual([`http://env.proxy.test:${targetPort}/`])
    }
    finally {
      vi.stubEnv('http_proxy', '')
      routesChanged()
    }
  })

  it('picks up changed routes', async () => {
    const route = createRoute({
      match: 'switch.test',
      via: 'socks5h',
      proxy: `127.0.0.1:${socksPort}`,
      dns: 'system',
    })

    routesChanged()
    await (await netFetch(`http://switch.test:${targetPort}/`)).text()
    deleteRoute(route.id)
    routesChanged()

    await expect(
      netFetch(`http://switch.test:${targetPort}/`),
    ).rejects.toThrow()
    expect(socksLog.requested).toHaveLength(1)
  })
})
