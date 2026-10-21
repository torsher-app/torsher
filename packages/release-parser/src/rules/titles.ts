import type { ParseContext } from '../context.ts'
import type { Token } from '../tokenize.ts'
import type { ReleaseTitles } from '../types.ts'

const CYRILLIC = /\p{Script=Cyrillic}/gu
const LATIN = /[a-z]/gi

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

const RUSSIAN_SHORT_WORDS = new Set([
  'v',
  'na',
  's',
  'k',
  'ne',
  'iz',
  'ot',
  'do',
  'za',
  'po',
  'pro',
  'bez',
  'dlya',
  'i',
])
const ENGLISH_WORDS = new Set([
  'the',
  'of',
  'and',
  'a',
  'an',
  'in',
  'to',
  'is',
  'my',
  'me',
  'you',
  'with',
  'for',
  'on',
  'at',
  'it',
  'we',
  'his',
  'her',
])
const TRANSLIT_ENDINGS = /(?:iy|yy|aya|oye|yye|ogo|ykh|ikh|ii|ov|ev|ya|yu)$/
const TRANSLIT_DIGRAPHS = /zh|kh|shch|tsy/

function script(text: string): 'cyrillic' | 'latin' | 'none' {
  const cyrillic = text.match(CYRILLIC)?.length ?? 0
  const latin = text.match(LATIN)?.length ?? 0
  if (cyrillic === 0 && latin === 0)
    return 'none'
  return cyrillic >= latin ? 'cyrillic' : 'latin'
}

function transliterate(text: string) {
  return [...text.toLowerCase()].map(char => TRANSLIT[char] ?? char).join('')
}

function letters(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function similarity(a: string, b: string) {
  if (!a || !b)
    return 0
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = current
    }
  }
  return 1 - row[b.length]! / Math.max(a.length, b.length)
}

/** Сколько слов похожи на русский транслит: `zh`, `kh`, окончания `-iy`, `-ogo`, предлоги `v`, `na`. */
function translitScore(text: string) {
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
  if (words.length === 0)
    return 0
  let score = 0
  words.forEach((word, i) => {
    if (ENGLISH_WORDS.has(word)) {
      score -= 1
    }
    else if (
      TRANSLIT_DIGRAPHS.test(word)
      || (word.length > 3 && TRANSLIT_ENDINGS.test(word))
    ) {
      score += 1
    }
    else if (RUSSIAN_SHORT_WORDS.has(word) && (i > 0 || word !== 'i')) {
      score += 1
    }
  })
  return score / words.length
}

/**
 * Латиница — транслит, если совпадает с транслитерацией русского названия раздачи,
 * а без русского названия — если похожа на русские слова латиницей.
 */
export function isTranslit(latin: string, ru?: string) {
  const score = translitScore(latin)
  // Одно слово вроде «Мастер / Master» совпадает с транслитом и у иностранного названия
  if (ru && isCloseToRu(latin, ru))
    return latin.trim().split(/\s+/).length > 1 || score > 0
  return score >= 0.5
}

function isCloseToRu(latin: string, ru: string) {
  return similarity(letters(transliterate(ru)), letters(latin)) >= 0.7
}

function isDotted(ctx: ParseContext, tokens: Token[]) {
  const first = tokens[0]
  const last = tokens.at(-1)
  if (!first || !last)
    return false
  const text = ctx.raw.slice(first.start, last.end)
  return !text.includes(' ') && /[._]/.test(text)
}

/** Текст из токенов с исходными разделителями; точки и подчёркивания scene-имени становятся пробелами. */
function textOf(ctx: ParseContext, tokens: Token[]) {
  const words = [...tokens]
  while (words[0]?.kind === 'punct') words.shift()
  while (words.at(-1)?.kind === 'punct') words.pop()
  if (words.length === 0)
    return ''

  const dotted = isDotted(ctx, words)
  let text = words[0]!.value
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]!
    const token = words[i]!
    const gap
      = token.index === prev.index + 1
        ? ctx.raw.slice(prev.end, token.start)
        : ' '
    text
      += (dotted ? gap.replace(/[._]+/g, ' ') : gap.replace(/\s+/g, ' '))
        + token.value
  }
  return text.trim()
}

/**
 * Названия до первого разобранного токена: сегменты через ` / ` и скобки
 * вроде `Название (Original)`. Кириллица — `ru`, латиница — `orig` или `translit`,
 * лишние — `alt`.
 */
export function parseTitles(
  ctx: ParseContext,
  titleEnd: number,
): ReleaseTitles {
  const zone = ctx.tokens
    .slice(0, titleEnd)
    .filter(token => !ctx.isClaimed(token))
  const candidates: { text: string, tokens: Token[] }[] = []

  const topLevel = zone.filter(token => token.group === undefined)
  for (const segment of new Set(topLevel.map(token => token.segment))) {
    const tokens = topLevel.filter(token => token.segment === segment)
    candidates.push({ text: textOf(ctx, tokens), tokens })
  }

  // Название после ` / ` уже за сезоном: `Название (Сезон 1) / Original (2024)`
  for (const slash of ctx.tokens.slice(titleEnd)) {
    if (
      slash.kind !== 'punct'
      || slash.value !== '/'
      || slash.group !== undefined
    ) {
      continue
    }
    const run: Token[] = []
    for (const token of ctx.tokens.slice(slash.index + 1)) {
      if (
        token.group !== undefined
        || ctx.isClaimed(token)
        || token.afterPipe
        || token.kind === 'punct'
      ) {
        break
      }
      run.push(token)
    }
    if (run.length > 0)
      candidates.push({ text: textOf(ctx, run), tokens: run })
  }

  for (const group of ctx.groups) {
    if (
      group.parent !== undefined
      || group.start > (ctx.tokens[titleEnd]?.start ?? ctx.raw.length)
    ) {
      continue
    }
    const tokens = ctx.groupTokensDeep(group.id)
    if (tokens.length === 0 || tokens.some(token => ctx.isClaimed(token)))
      continue
    candidates.push({ text: textOf(ctx, tokens), tokens })
  }

  // Название после разобранного начала: `[S01] Название`
  if (candidates.length === 0) {
    const run: Token[] = []
    for (const token of ctx.tokens.slice(titleEnd)) {
      if (
        token.group !== undefined
        || token.kind === 'punct'
        || token.afterPipe
        || ctx.isClaimed(token)
      ) {
        if (run.length > 0)
          break
        continue
      }
      run.push(token)
    }
    if (run.length > 0)
      candidates.push({ text: textOf(ctx, run), tokens: run })
  }

  const titles: ReleaseTitles = {}
  const alt: string[] = []
  const latin: string[] = []

  for (const { text, tokens } of candidates) {
    const kind = script(text)
    if (kind === 'none' && !/\d/.test(text))
      continue
    ctx.claim(tokens, 'titles')
    if (kind === 'latin')
      latin.push(text)
    else if (!titles.ru && kind === 'cyrillic')
      titles.ru = text
    else if (kind === 'none' && candidates.length === 1)
      titles.orig = text
    else alt.push(text)
  }

  // Среди нескольких латинских названий транслит — то, что совпадает с русским
  const ru = titles.ru
  const close
    = ru && latin.length > 1
      ? latin.find(text => isCloseToRu(text, ru))
      : undefined
  for (const text of latin) {
    if (!titles.translit && (close ? text === close : isTranslit(text, ru)))
      titles.translit = text
    else if (!titles.orig)
      titles.orig = text
    else alt.push(text)
  }

  if (alt.length > 0)
    titles.alt = alt
  if (titles.ru || titles.orig || titles.translit)
    ctx.setConfidence('titles', candidates.length > 0 ? 0.8 : 0)
  return titles
}
