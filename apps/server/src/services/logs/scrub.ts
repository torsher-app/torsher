import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from '../../config.ts'

const REDACTED = '[redacted]'

// Параметр и в экранированном адресе (`&amp;`, `%3F…%3D`); значение кончается
// на `&`, пробеле, кавычке или `\` экранирования JSON
const SECRET_PARAM
  = /((?:[?&#]|&amp;|%3F|%26)(?:token|access_token|refresh_token|apikey|api_key|passkey|password|sig|key)(?:=|%3D))[^&\s"\\]+/gi

// Заголовок, попавший в текст ошибки. Значение не выходит за строку JSON
const SECRET_AUTHORIZATION
  = /(authorization):\s*(?:(?:bearer|basic)\s+)?[^\s"\\]+/gi

// Учётные данные прокси и индексаторов в адресе: `socks5h://user:pass@host`
const URL_CREDENTIALS = /\b([a-z][a-z\d+.-]*:\/\/)[^\s/@"\\]+@/gi

const SECRET_HEADER
  = /("(?:authorization|cookie|set-cookie|x-api-key)":)(?:"(?:[^"\\]|\\.)*"|\[(?:"(?:[^"\\]|\\.)*",?)*\])/gi

let downloadsPattern: RegExp | null | undefined

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function downloadsPrefixes() {
  const raw = config.downloadsPath
  const prefixes = new Set([raw, resolve(raw)])

  try {
    prefixes.add(realpathSync.native(raw))
  }
  catch {}

  // Строка записи — уже JSON: `\` в путях Windows там удвоены
  for (const prefix of [...prefixes])
    prefixes.add(JSON.stringify(prefix).slice(1, -1))

  return (
    [...prefixes]
      .map(prefix => prefix.replace(/[/\\]+$/, ''))
      .filter(Boolean)
      // Длинные первыми: абсолютный путь не должен обрезаться по относительному
      .sort((a, b) => b.length - a.length)
  )
}

/**
 * Имя каталога раздачи в загрузках — её название, поэтому путь прячется до
 * конца строки JSON: в названии бывают `'` и `: `, и по ним путь не отделить
 * от причины ошибки. Строка кончается на кавычке, `\"` или переводе строки.
 */
function downloadsRegExp() {
  if (downloadsPattern !== undefined)
    return downloadsPattern

  const prefixes = downloadsPrefixes()
  const bareEnd = String.raw`(?=\\"|["']|: |\\n|\n|$)`
  // В JSON `\` пути Windows удвоен
  const separator = String.raw`(?:/|\\{1,2})`
  // Символы строки JSON и escape-пары, кроме `\n` и `\"`
  const tail = String.raw`(?:[^"\\\n]|\\[^n"])*`

  downloadsPattern = prefixes.length
    ? new RegExp(
        `(?:${prefixes.map(escapeRegExp).join('|')})(?:${bareEnd}|(${separator}${tail}))`,
        'g',
      )
    : null

  return downloadsPattern
}

/** Пересчитать каталог загрузок: он читается из окружения при первой записи */
export function resetScrub() {
  downloadsPattern = undefined
}

/**
 * Очищает готовую строку записи до любого вывода: секреты в адресах и
 * заголовках, пути внутри каталога загрузок. Работает по тексту, поэтому
 * ловит секрет и в сообщении, и в любом поле.
 */
export function scrubText(text: string) {
  let result = text
    .replace(SECRET_PARAM, `$1${REDACTED}`)
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(SECRET_HEADER, `$1"${REDACTED}"`)
    .replace(SECRET_AUTHORIZATION, `$1: ${REDACTED}`)

  const downloads = downloadsRegExp()

  if (downloads) {
    result = result.replace(downloads, (_match, tail?: string) =>
      tail ? '<downloads>/…' : '<downloads>')
  }

  return result
}
