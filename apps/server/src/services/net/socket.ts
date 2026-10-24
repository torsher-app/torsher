import type { NetConnectOpts, Socket } from 'node:net'
import type { NetRoute } from '../../db/schema.ts'
import { Buffer } from 'node:buffer'
import { connect } from 'node:net'
import { SocksClient } from 'socks'
import { dohUrlOf } from './dispatchers.ts'
import { dohResolverFor } from './doh.ts'
import { proxyCredentials } from './routes.ts'

const CONNECT_TIMEOUT_MS = 10_000

/** `host:port` прокси, в том числе `[::1]:1080` */
function splitAddress(address: string) {
  const match = /^\[?([^\]]+)\]?:(\d+)$/.exec(address)

  if (!match)
    throw new Error('Invalid proxy address')

  return { host: match[1]!, port: Number(match[2]) }
}

function tcp(options: NetConnectOpts) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(options)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Connection timed out'))
    }, CONNECT_TIMEOUT_MS)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.removeListener('error', reject)
      resolve(socket)
    })
    socket.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/** HTTP CONNECT: прокси сам разрешает имя, как у маршрута `http` в `netFetch` */
async function httpConnect(route: NetRoute, host: string, port: number) {
  const proxy = splitAddress(route.proxyAddress ?? '')
  const { username, password } = proxyCredentials(route)
  const socket = await tcp({ host: proxy.host, port: proxy.port })
  const target = `${host.includes(':') ? `[${host}]` : host}:${port}`
  const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`]

  if (username) {
    lines.push(
      `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`,
    )
  }

  socket.write(`${lines.join('\r\n')}\r\n\r\n`)

  // Ответ прокси читается через `readable`, а не `data`: так сокет не
  // переходит в поток, и приветствие сервера, пришедшее до того, как клиент
  // протокола подпишется на данные, остаётся в буфере, а не теряется
  return new Promise<Socket>((resolve, reject) => {
    let head = Buffer.alloc(0)
    const fail = (err: Error) => {
      cleanup()
      socket.destroy()
      reject(err)
    }
    const timer = setTimeout(
      () => fail(new Error('Proxy timed out')),
      CONNECT_TIMEOUT_MS,
    )

    function cleanup() {
      clearTimeout(timer)
      socket.removeListener('readable', onReadable)
      socket.removeListener('error', fail)
    }

    function onReadable() {
      for (let chunk = socket.read(); chunk !== null; chunk = socket.read()) {
        head = Buffer.concat([head, chunk])

        const end = head.indexOf('\r\n\r\n')

        if (end === -1) {
          if (head.length > 8192) {
            fail(new Error('Proxy response is too long'))
            return
          }

          continue
        }

        cleanup()

        const status = head.subarray(0, end).toString('latin1')

        if (!/^HTTP\/1\.[01] 200/.test(status)) {
          socket.destroy()
          reject(
            new Error(
              `Proxy refused: ${status.slice(0, status.indexOf('\r\n'))}`,
            ),
          )
          return
        }

        // Байты после заголовка — уже ответ сервера: вернуть их в буфер
        const rest = head.subarray(end + 4)

        if (rest.length)
          socket.unshift(rest)

        resolve(socket)
        return
      }
    }

    socket.on('readable', onReadable)
    socket.once('error', fail)
  })
}

/**
 * TCP-соединение по маршруту хоста — для протоколов не по HTTP (SMTP):
 * SOCKS5 с именем хоста, HTTP CONNECT или DoH маршрута. `undefined` —
 * маршруту нечего добавить, соединение открывает сам клиент протокола.
 */
export async function connectThroughRoute(
  route: NetRoute,
  host: string,
  port: number,
): Promise<Socket | undefined> {
  if (route.via === 'socks5h') {
    const proxy = splitAddress(route.proxyAddress ?? '')
    const { username, password } = proxyCredentials(route)
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: username,
        password,
      },
      destination: { host, port },
      command: 'connect',
      timeout: CONNECT_TIMEOUT_MS,
    })

    return socket
  }

  if (route.via === 'http')
    return httpConnect(route, host, port)

  const dohUrl = dohUrlOf(route)

  // Системный DNS и прокси из окружения (он только для HTTP) — соединение
  // открывает сам клиент протокола
  return dohUrl
    ? tcp({ host, port, lookup: dohResolverFor(dohUrl).lookup })
    : undefined
}
