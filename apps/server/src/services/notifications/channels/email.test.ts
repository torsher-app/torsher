import type { AddressInfo, Server, Socket } from 'node:net'
import { Buffer } from 'node:buffer'
import { connect, createServer } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb, migrateDb } from '../../../db/index.ts'
import { netRoutes } from '../../../db/schema.ts'
import {
  connectThroughRoute,
  createRoute,
  routeForHost,
  routesChanged,
} from '../../net/index.ts'
import { renderTest } from '../render.ts'
import { email } from './email.ts'
import {
  createChannel,
  decryptConfig,
  getChannel,
  updateChannel,
} from './store.ts'

interface Received {
  auth?: string
  from?: string
  to?: string
  data?: string
}

/** SMTP-заглушка: ровно столько протокола, сколько нужно Nodemailer без TLS */
function smtpServer(options: { rejectAuth?: boolean } = {}) {
  const received: Received[] = []
  const server = createServer((socket) => {
    const mail: Received = {}
    let buffer = ''
    let inData = false

    received.push(mail)
    socket.write('220 localhost ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')

      for (
        let end = buffer.indexOf('\r\n');
        end !== -1;
        end = buffer.indexOf('\r\n')
      ) {
        const line = buffer.slice(0, end)

        buffer = buffer.slice(end + 2)

        if (inData) {
          if (line === '.') {
            inData = false
            socket.write('250 queued\r\n')
          }
          else {
            mail.data = `${mail.data ?? ''}${line}\n`
          }

          continue
        }

        const command = line.slice(0, 4).toUpperCase()

        if (command === 'EHLO') {
          socket.write('250-localhost\r\n250 AUTH PLAIN\r\n')
        }
        else if (command === 'AUTH') {
          mail.auth = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString(
            'utf8',
          )
          socket.write(
            options.rejectAuth ? '535 bad credentials\r\n' : '235 ok\r\n',
          )
        }
        else if (command === 'MAIL') {
          mail.from = line
          socket.write('250 ok\r\n')
        }
        else if (command === 'RCPT') {
          mail.to = line
          socket.write('250 ok\r\n')
        }
        else if (command === 'DATA') {
          inData = true
          socket.write('354 go\r\n')
        }
        else if (command === 'QUIT') {
          socket.end('221 bye\r\n')
        }
        else {
          socket.write('250 ok\r\n')
        }
      }
    })
  })

  return { server, received }
}

/** HTTP CONNECT-прокси: пропускает к цели и запоминает, куда просили */
function connectProxy() {
  const targets: string[] = []
  const server = createServer((client) => {
    client.once('data', (chunk) => {
      const head = chunk.toString('latin1')
      const target = /^CONNECT (\S+) /.exec(head)?.[1] ?? ''
      const [host, port] = target.split(':')

      targets.push(target)

      const upstream: Socket = connect(
        Number(port),
        host === 'smtp.example' ? '127.0.0.1' : host!,
        () => {
          client.write('HTTP/1.1 200 Connection established\r\n\r\n')
          upstream.pipe(client)
          client.pipe(upstream)
        },
      )
    })
  })

  return { server, targets }
}

function listen(server: Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port))
  })
}

const message = renderTest('en_US', 'http://torsher.local/panel')
let smtp: ReturnType<typeof smtpServer>
let smtpPort: number

beforeAll(async () => {
  await migrateDb()
  smtp = smtpServer()
  smtpPort = await listen(smtp.server)
})

beforeEach(() => {
  getDb().delete(netRoutes).run()
  routesChanged()
  smtp.received.length = 0
})

afterAll(() => {
  smtp.server.close()
})

describe('email', () => {
  it('отправляет письмо с логином и ссылкой на панель', async () => {
    await email.send(message, {
      host: '127.0.0.1',
      port: smtpPort,
      security: 'none',
      username: 'owner',
      password: 'pass',
      from: 'torsher@example.com',
      to: 'owner@example.com',
    })

    const [mail] = smtp.received

    expect(mail?.auth).toBe('\0owner\0pass')
    expect(mail?.to).toContain('owner@example.com')
    expect(mail?.data).toContain('Subject: Torsher test notification')
    expect(mail?.data).toContain(
      'Open the panel: http://torsher.local/panel/settings/notifications',
    )
  })

  it('пробелы в пароле сохраняются и уходят в SMTP', async () => {
    const input = {
      kind: 'email' as const,
      name: 'Mail',
      enabled: true,
      language: 'en_US' as const,
      panelUrl: null,
      config: {
        host: ' 127.0.0.1 ',
        port: smtpPort,
        security: 'none',
        username: 'owner',
        password: ' pass ',
        from: 'torsher@example.com',
        to: 'owner@example.com',
      },
      events: ['problems' as const],
      includeWarnings: false,
      notifyResolved: false,
    }
    const { id } = createChannel(input)

    // Пустой пароль при правке — оставить сохранённый, с теми же пробелами
    updateChannel(id, { ...input, config: { ...input.config, password: '' } })

    const config = decryptConfig(email, getChannel(id)!.config)

    expect(config).toMatchObject({ host: '127.0.0.1', password: ' pass ' })

    await email.send(message, config as Parameters<typeof email.send>[1])

    expect(smtp.received[0]?.auth).toBe('\0owner\0 pass ')
  })

  it('пароль из одних пробелов при правке оставляет сохранённый', () => {
    const input = {
      kind: 'email' as const,
      name: 'Mail',
      enabled: true,
      language: 'en_US' as const,
      panelUrl: null,
      config: {
        host: '127.0.0.1',
        port: smtpPort,
        security: 'none',
        username: 'owner',
        password: 'pass',
        from: 'torsher@example.com',
        to: 'owner@example.com',
      },
      events: ['problems' as const],
      includeWarnings: false,
      notifyResolved: false,
    }
    const { id } = createChannel(input)

    updateChannel(id, {
      ...input,
      config: { ...input.config, password: '   ' },
    })

    expect(decryptConfig(email, getChannel(id)!.config).password).toBe('pass')
  })

  it('неверный пароль — unauthorized', async () => {
    const strict = smtpServer({ rejectAuth: true })
    const port = await listen(strict.server)

    await expect(
      email.send(message, {
        host: '127.0.0.1',
        port,
        security: 'none',
        username: 'owner',
        password: 'wrong',
        from: 'torsher@example.com',
        to: 'owner@example.com',
      }),
    ).rejects.toMatchObject({ kind: 'unauthorized' })

    strict.server.close()
  })

  it('идёт через HTTP-прокси маршрута хоста', async () => {
    const proxy = connectProxy()
    const proxyPort = await listen(proxy.server)

    createRoute({
      match: 'smtp.example',
      via: 'http',
      proxy: `127.0.0.1:${proxyPort}`,
      dns: 'system',
    })
    routesChanged()

    await email.send(message, {
      host: 'smtp.example',
      port: smtpPort,
      security: 'none',
      from: 'torsher@example.com',
      to: 'owner@example.com',
    })

    expect(proxy.targets).toEqual([`smtp.example:${smtpPort}`])
    expect(smtp.received[0]?.data).toContain('Torsher test notification')

    proxy.server.close()
  })

  it('данные сервера, пришедшие сразу после ответа прокси, не теряются', async () => {
    // Прокси отвечает 200 и сразу шлёт приветствие сервера, а клиент
    // протокола подписывается на сокет позже — как Nodemailer после getSocket
    const proxy = createServer((client) => {
      client.once('data', () => {
        client.write('HTTP/1.1 200 Connection established\r\n\r\n')
        setTimeout(() => client.write('220 late greeting\r\n'), 20)
      })
    })
    const proxyPort = await listen(proxy)

    createRoute({
      match: 'smtp-late.example',
      via: 'http',
      proxy: `127.0.0.1:${proxyPort}`,
      dns: 'system',
    })
    routesChanged()

    const socket = (await connectThroughRoute(
      routeForHost('smtp-late.example'),
      'smtp-late.example',
      25,
    ))!

    await new Promise(resolve => setTimeout(resolve, 80))

    const greeting = await new Promise<string>((resolve) => {
      socket.once('data', chunk => resolve(chunk.toString('latin1')))
    })

    expect(greeting).toBe('220 late greeting\r\n')

    socket.destroy()
    proxy.close()
  })
})
