import type { ParseContext } from '../context.ts'
import type { Token } from '../tokenize.ts'
import { isYearLike } from './numbers.ts'

const YEAR = /^(\d{4})(?:-(\d{4}))?$/

/**
 * Год выпуска. Год в скобках надёжнее голого; из голых берём последний, а голый год
 * первым словом считаем названием (`1917.1080p.BluRay`). У диапазона `2019-2024` — первый.
 */
export function parseYear(ctx: ParseContext): number | undefined {
  let best: { token: Token, year: number, score: number } | undefined
  const firstWord = ctx.tokens.find(token => token.kind === 'word')

  for (const token of ctx.tokens) {
    if (token.kind !== 'word' || ctx.isClaimed(token))
      continue
    const match = YEAR.exec(token.norm)
    if (
      !match
      || !isYearLike(Number(match[1]))
      || (match[2] && !isYearLike(Number(match[2])))
    ) {
      continue
    }

    const score = token.group === undefined ? 1 : 2
    if (score === 1 && token === firstWord)
      continue
    if (!best || score >= best.score)
      best = { token, year: Number(match[1]), score }
  }

  if (!best)
    return undefined

  ctx.claim(best.token, 'year')
  ctx.setConfidence('year', best.score === 2 ? 1 : 0.8)
  return best.year
}
