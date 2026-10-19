import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { language } from './language.ts'

// Читаем каталог, а не index.ts: новая локаль проверяется, даже если её ещё не подключили
const LOCALES_DIR = join(import.meta.dirname, 'locales')
const REFERENCE = 'en_US'

function localeDirs() {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

function namespaces(locale: string) {
  return readdirSync(join(LOCALES_DIR, locale))
    .filter(file => file.endsWith('.json'))
    .sort()
}

function read(locale: string, file: string): unknown {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), 'utf8'))
}

// Плоский список путей до строк: { a: { b: 'x' } } → ['a.b']
function keyPaths(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null)
    return [prefix]

  return Object.entries(node).flatMap(([key, value]) =>
    keyPaths(value, prefix ? `${prefix}.${key}` : key),
  )
}

function emptyValues(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string')
    return node.trim() ? [] : [prefix]

  if (typeof node !== 'object' || node === null)
    return [prefix]

  return Object.entries(node).flatMap(([key, value]) =>
    emptyValues(value, prefix ? `${prefix}.${key}` : key),
  )
}

it('каждая папка локали описана в language.ts и наоборот', () => {
  expect(localeDirs()).toEqual(Object.keys(language).sort())
})

describe.each(localeDirs())('локаль %s', (locale) => {
  it(`содержит те же файлы, что ${REFERENCE}`, () => {
    expect(namespaces(locale)).toEqual(namespaces(REFERENCE))
  })

  it.each(namespaces(REFERENCE))(
    `%s совпадает с ${REFERENCE} по ключам`,
    (file) => {
      expect(keyPaths(read(locale, file)).sort()).toEqual(
        keyPaths(read(REFERENCE, file)).sort(),
      )
    },
  )

  it.each(namespaces(REFERENCE))('%s не содержит пустых строк', (file) => {
    expect(emptyValues(read(locale, file))).toEqual([])
  })
})
