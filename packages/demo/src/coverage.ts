import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Api } from '@torsher/api-client'
import { match } from './router.ts'

/**
 * Проверка для тестов приложений: каждый метод сгенерированного клиента,
 * который зовёт приложение, находит маршрут мока. Новый эндпоинт без мока
 * роняет тест, а не демо после выкладки.
 */

function sourceFiles(dir: string, skipDir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      return name === skipDir ? [] : sourceFiles(path, skipDir)

    return /\.(?:ts|vue)$/.test(name) && !name.endsWith('.test.ts')
      ? [path]
      : []
  })
}

/** Методы клиента в исходниках приложения: `torrents.getTorrents` */
export function usedApiMethods(dir: string, skipDir = 'demo') {
  const names = new Set<string>()

  for (const file of sourceFiles(dir, skipDir)) {
    for (const found of readFileSync(file, 'utf8').matchAll(
      // Имя метода бывает на следующей строке: `api.titles\n  .getTitleUpNext(`
      /\bapi\.(\w+)\s*\.(\w+)\(/g,
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

/** Методы, для которых у роутера нет маршрута: `имя METHOD /путь` */
export async function unroutedMethods(names: string[]) {
  const missing: string[] = []

  for (const name of names) {
    const request = await requestOf(name)
    if (!request || !match(request.method, request.path))
      missing.push(`${name} ${request?.method} ${request?.path}`)
  }

  return missing
}
