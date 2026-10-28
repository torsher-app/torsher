import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Api } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { handle, match } from './router'
import './handlers'

const APP_DIR = join(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      return name === 'demo' ? [] : sourceFiles(path)

    return /\.(?:ts|vue)$/.test(name) ? [path] : []
  })
}

/** Методы сгенерированного клиента, которые зовёт панель: `api.torrents.getTorrents` */
function usedMethods() {
  const names = new Set<string>()

  for (const file of sourceFiles(APP_DIR)) {
    for (const found of readFileSync(file, 'utf8').matchAll(
      /\bapi\.(\w+)\.(\w+)\(/g,
    )) {
      names.add(`${found[1]}.${found[2]}`)
    }
  }

  return [...names].sort()
}

/**
 * Метод и путь запроса метода клиента. Аргументы подставные: в пути они
 * становятся сегментом `:p`, а query и тело роутеру не важны
 */
async function requestOf(name: string) {
  const [module, method] = name.split('.') as [string, string]
  let recorded: { method: string, path: string } | undefined

  const api = new Api({
    customFetch: async (input, init) => {
      recorded = {
        method: init?.method ?? 'GET',
        path: new URL(String(input), 'http://demo').pathname,
      }
      return new Response('{}')
    },
  })

  const placeholder = { toString: () => ':p' }
  const fn = (
    api as unknown as Record<
      string,
      Record<string, (...args: unknown[]) => Promise<unknown>>
    >
  )[module]?.[method]
  if (!fn)
    return undefined

  await fn(placeholder, placeholder, placeholder, placeholder).catch(
    () => undefined,
  )

  return recorded
}

describe('demo router', () => {
  it('answers every request the panel makes', async () => {
    const missing: string[] = []

    for (const name of usedMethods()) {
      const request = await requestOf(name)
      if (!request || !match(request.method, request.path))
        missing.push(`${name} ${request?.method} ${request?.path}`)
    }

    expect(missing).toEqual([])
  })

  it('answers an unknown path with 501 and the given message', async () => {
    const response = await handle(
      new URL('http://demo/api/nowhere'),
      { method: 'GET' },
      'Not available in the demo',
    )

    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({
      message: 'Not available in the demo',
    })
  })
})
