export type GroupKind = 'square' | 'round' | 'curly'

export interface Group {
  id: number
  kind: GroupKind
  /** Позиции скобок в исходной строке. */
  start: number
  end: number
  /** Внешняя группа, если скобки вложены. */
  parent?: number
}

export type PunctValue = '|' | '/' | '+' | '-' | ':' | ',' | ';'

export interface Token {
  index: number
  kind: 'word' | 'punct'
  value: string
  /** Нижний регистр, `ё` → `е`: по нему сравнивают правила. */
  norm: string
  start: number
  end: number
  /** Ближайшая скобочная группа; нет — токен на верхнем уровне. */
  group?: number
  /** Номер сегмента верхнего уровня: сегменты разделяет ` / `. */
  segment: number
  /** Токен стоит после `|` верхнего уровня. */
  afterPipe: boolean
}

export interface Tokenized {
  raw: string
  tokens: Token[]
  groups: Group[]
}

const OPEN: Record<string, GroupKind> = {
  '[': 'square',
  '(': 'round',
  '{': 'curly',
}
const CLOSE: Record<string, GroupKind> = {
  ']': 'square',
  ')': 'round',
  '}': 'curly',
}
const PUNCT = new Set<string>(['|', '/', '+', ':', ',', ';'])
const SEPARATORS = new Set<string>([' ', '\t', '.', '_'])

export function normalize(value: string) {
  return value.toLowerCase().replaceAll('ё', 'е')
}

function isBoundary(char: string | undefined) {
  return (
    char === undefined
    || SEPARATORS.has(char)
    || PUNCT.has(char)
    || char in OPEN
    || char in CLOSE
  )
}

function isDigit(char: string | undefined) {
  return char !== undefined && char >= '0' && char <= '9'
}

/**
 * Конец слова, которое начинается в `start`. Точка разделяет слова scene-имени,
 * но остаётся внутри `H.264`, `5.1`, `DDP5.1` и `2.0`: там она часть тега.
 */
function wordEnd(raw: string, start: number) {
  const codec = /^h\.26[45]/i.exec(raw.slice(start))
  let end = codec ? start + codec[0].length : start

  while (end < raw.length && !isBoundary(raw[end])) end++

  // `5.1` и `7.1-GRP`: десятичная точка остаётся в слове, дальше слово может продолжиться дефисом
  if (
    raw[end] === '.'
    && isDigit(raw[end - 1])
    && isDigit(raw[end + 1])
    && (isBoundary(raw[end + 2]) || raw[end + 2] === '-')
  ) {
    end += 2
    while (end < raw.length && !isBoundary(raw[end])) end++
  }

  return end
}

/**
 * Делит название раздачи на токены, не теряя исходных позиций. Скобки задают
 * группы, ` / ` верхнего уровня — сегменты названий, `|` значимый и остаётся
 * токеном: после него в русских раздачах идёт озвучка.
 */
export function tokenize(raw: string): Tokenized {
  const tokens: Token[] = []
  const groups: Group[] = []
  const stack: Group[] = []
  let segment = 0
  let afterPipe = false
  let i = 0

  const push = (kind: Token['kind'], start: number, end: number) => {
    const value = raw.slice(start, end)
    tokens.push({
      index: tokens.length,
      kind,
      value,
      norm: normalize(value),
      start,
      end,
      group: stack.at(-1)?.id,
      segment,
      afterPipe,
    })
  }

  while (i < raw.length) {
    const char = raw[i]!

    if (char in OPEN) {
      const group: Group = {
        id: groups.length,
        kind: OPEN[char]!,
        start: i,
        end: raw.length,
        parent: stack.at(-1)?.id,
      }
      groups.push(group)
      stack.push(group)
      i++
      continue
    }

    if (char in CLOSE) {
      // Закрываем ближайшую группу того же вида; непарную скобку пропускаем
      const at = stack.findLastIndex(group => group.kind === CLOSE[char])
      if (at !== -1) {
        stack[at]!.end = i
        stack.length = at
      }
      i++
      continue
    }

    if (SEPARATORS.has(char)) {
      i++
      continue
    }

    if (PUNCT.has(char)) {
      push('punct', i, i + 1)
      if (stack.length === 0) {
        if (char === '/' && (raw[i - 1] === ' ' || raw[i + 1] === ' '))
          segment++
        if (char === '|')
          afterPipe = true
      }
      i++
      continue
    }

    // Одиночный дефис между пробелами — разделитель, а не часть слова
    if (char === '-' && isBoundary(raw[i + 1])) {
      push('punct', i, i + 1)
      i++
      continue
    }

    const end = wordEnd(raw, i)
    push('word', i, end)
    i = end
  }

  return { raw, tokens, groups }
}
