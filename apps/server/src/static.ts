import type { FastifyInstance, FastifyReply } from 'fastify'
import { existsSync } from 'node:fs'
import { extname, relative, sep } from 'node:path'
import fastifyStatic from '@fastify/static'

/** Каталоги собранных клиентов */
export interface ClientDirs {
  /** Витрина (`apps/tv/dist`) */
  tv: string
  /** Панель (`apps/web/.output/public`) */
  panel: string
}

export const PANEL_PREFIX = '/panel'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

/**
 * Ассеты с хешем в имени кэшируются навсегда, всё остальное (index.html,
 * favicon) браузер перепроверяет, иначе после обновления остался бы старый UI.
 * У Nuxt `_nuxt/builds/` — манифест сборки без хеша в имени.
 */
function cacheHeaders(root: string, hashedDir: string, except?: string) {
  return (reply: FastifyReply, path: string) => {
    const file = relative(root, path).split(sep).join('/')
    const hashed
      = file.startsWith(`${hashedDir}/`)
        && !(except && file.startsWith(`${except}/`))

    reply.header('Cache-Control', hashed ? IMMUTABLE : REVALIDATE)
  }
}

// Путь без расширения — маршрут SPA, а не потерянный файл
function isPageRequest(method: string, url: string) {
  const path = url.split('?')[0] ?? ''

  return (method === 'GET' || method === 'HEAD') && !extname(path)
}

/**
 * Витрина на `/` и панель на `/panel/` с того же origin, что и API: запросы
 * с ТВ в локальную сеть не упираются в Private Network Access. Витрина
 * работает на hash-истории и fallback не требует; у панели история
 * обычная, поэтому её маршруты отдают `index.html`.
 */
export function registerClients(app: FastifyInstance, dirs: ClientDirs) {
  for (const [name, dir] of Object.entries(dirs)) {
    if (!existsSync(dir))
      app.log.warn(`${name}: сборка не найдена (${dir}), выполните pnpm build`)
  }

  if (existsSync(dirs.tv)) {
    app.register(async (tv) => {
      tv.register(fastifyStatic, {
        root: dirs.tv,
        cacheControl: false,
        setHeaders: cacheHeaders(dirs.tv, 'assets'),
      })
    })
  }

  if (existsSync(dirs.panel)) {
    app.get(PANEL_PREFIX, (_request, reply) =>
      reply.redirect(`${PANEL_PREFIX}/`))

    app.register(
      async (panel) => {
        panel.register(fastifyStatic, {
          root: dirs.panel,
          cacheControl: false,
          setHeaders: cacheHeaders(dirs.panel, '_nuxt', '_nuxt/builds'),
        })

        panel.setNotFoundHandler((request, reply) => {
          if (isPageRequest(request.method, request.url))
            return reply.sendFile('index.html')

          return reply.code(404).send({ message: 'Not Found' })
        })
      },
      { prefix: PANEL_PREFIX },
    )
  }
}
