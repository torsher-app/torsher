import type { ParseContext } from '../context.ts'
import type { Token } from '../tokenize.ts'

export interface NumberRange {
  from: number
  to: number
  tokens: Token[]
}

export interface Total {
  /** Нет, если вместо числа `?`, `??`, `xx`. */
  total?: number
  tokens: Token[]
}

const ORDINALS: Record<string, number> = {
  первый: 1,
  первая: 1,
  второй: 2,
  вторая: 2,
  третий: 3,
  третья: 3,
  четвертый: 4,
  пятый: 5,
  шестой: 6,
  седьмой: 7,
  восьмой: 8,
  девятый: 9,
  десятый: 10,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
}

const RANGE = /^(\d{1,4})(?:-(\d{1,4}))?(?:-?(?:й|я|ий|ой|ый|th|st|nd|rd))?$/
const NUMBER = /^\d{1,4}$/
const UNKNOWN_TOTAL = /^(?:\?+|x+|х+)$/

export function isNumber(token: Token | undefined): token is Token {
  return token?.kind === 'word' && NUMBER.test(token.norm)
}

export function isPunct(
  token: Token | undefined,
  value: string,
): token is Token {
  return token?.kind === 'punct' && token.value === value
}

/** Число или диапазон: `5`, `01-10`, `1 - 8`, `1-й`, `первый`. */
export function readRange(
  ctx: ParseContext,
  token: Token | undefined,
): NumberRange | undefined {
  if (token?.kind !== 'word')
    return undefined

  const ordinal = ORDINALS[token.norm]
  if (ordinal)
    return { from: ordinal, to: ordinal, tokens: [token] }

  const match = RANGE.exec(token.norm)
  if (!match)
    return undefined

  const from = Number(match[1])
  if (match[2])
    return { from, to: Number(match[2]), tokens: [token] }

  const dash = ctx.next(token)
  const to = ctx.next(token, 2)
  if (isPunct(dash, '-') && isNumber(to))
    return { from, to: Number(to.norm), tokens: [token, dash, to] }

  return { from, to: from, tokens: [token] }
}

/** Хвост `из 12`, `of 30`, `из ??` или `(из 24)` сразу за токеном. */
export function readTotal(ctx: ParseContext, after: Token): Total | undefined {
  let word = ctx.next(after)
  if (!word) {
    const group = ctx.groupRightAfter(after)
    word = group && ctx.groupTokens(group.id)[0]
  }
  if (!word || (word.norm !== 'из' && word.norm !== 'of'))
    return undefined

  const value = ctx.next(word)
  if (value && UNKNOWN_TOTAL.test(value.norm))
    return { tokens: [word, value] }
  if (isNumber(value))
    return { total: Number(value.norm), tokens: [word, value] }
  return undefined
}

export function isYearLike(value: number) {
  return value >= 1900 && value <= new Date().getFullYear() + 2
}

export function expand(from: number, to: number) {
  if (to < from || to - from > 50)
    return [from]
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}
