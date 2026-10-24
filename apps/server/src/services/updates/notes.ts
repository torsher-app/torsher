export const NOTES_LIMIT = 8
const ITEM_MAX_LENGTH = 200

/** Разметку markdown — в текст: панель показывает пункты как есть, без HTML */
function plain(text: string) {
  return (
    text
      // Ссылки и картинки — их подпись
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/(\*\*|__|`)/g, '')
      // Хвост из коммита или номера PR, который добавляют генераторы changelog
      .replace(
        /\s*\((?:[0-9a-f]{7,40}|#\d+)(?:,\s*(?:[0-9a-f]{7,40}|#\d+))*\)\s*$/i,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function clip(text: string) {
  return text.length > ITEM_MAX_LENGTH
    ? `${text.slice(0, ITEM_MAX_LENGTH - 1).trimEnd()}…`
    : text
}

/**
 * Главное из release notes — пункты списков верхнего уровня по порядку.
 * Вложенные пункты и абзацы пропускаются: полный текст — по ссылке на релиз.
 */
export function releaseHighlights(body: string | null | undefined) {
  if (!body)
    return []

  const items: string[] = []

  for (const line of body.split(/\r?\n/)) {
    const match = /^ ?[-*+] (\S.*)$/.exec(line.replace(/^( ?[-*+]) +/, '$1 '))

    if (!match)
      continue

    const text = plain(match[1]!)

    if (text)
      items.push(clip(text))

    if (items.length === NOTES_LIMIT)
      break
  }

  return items
}
