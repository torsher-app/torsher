import type { ParseContext } from '../context.ts'
import type { Token } from '../tokenize.ts'
import type { AbsoluteRange, EpisodeRange, EpisodeUnit } from '../types.ts'
import type { NumberRange } from './numbers.ts'
import {
  expand,
  isNumber,
  isPunct,
  isYearLike,
  readRange,
  readTotal,
} from './numbers.ts'

export interface EpisodesResult {
  seasons: number[]
  episodes?: EpisodeRange
  absolute?: AbsoluteRange
  /** Полный сезон или сериал без явных номеров серий. */
  complete: boolean
  /** Раздача пополняется: серий меньше, чем в сезоне, или общее число неизвестно. */
  ongoing: boolean
}

type Keyword = 'season' | EpisodeUnit

const KEYWORDS: Record<string, Keyword> = {
  сезон: 'season',
  сезона: 'season',
  сезоны: 'season',
  сезонов: 'season',
  season: 'season',
  seasons: 'season',
  серия: 'episode',
  серии: 'episode',
  серий: 'episode',
  эпизод: 'episode',
  эпизода: 'episode',
  эпизоды: 'episode',
  эпизодов: 'episode',
  episode: 'episode',
  episodes: 'episode',
  ep: 'episode',
  eps: 'episode',
  выпуск: 'issue',
  выпуска: 'issue',
  выпуски: 'issue',
  выпусков: 'issue',
}

const COMPLETE = new Set(['complete', 'полный', 'полностью', 'все'])
const ONGOING = new Set(['ongoing', 'онгоинг'])

// S01, S01-S03, S01E02, S01E01-E03, S01E01-03, S01E01E02, S01E01-S01E03
const SCENE_SEASON = /^s(\d{1,2})(?:-s?(\d{1,2}))?$/
// Хвост `of30` без пробела тоже встречается: S01E01-20of30
const SCENE_EPISODE
  = /^s(\d{1,2})e(\d{1,4})((?:-?e\d{1,4}|-\d{1,4}|-s\d{1,2}e\d{1,4})*)(?:of(\d{1,4}))?$/
// 1x05, 13x01-19, 05x01-05x05
const CROSS = /^(\d{1,2})x(\d{1,3})(?:-(?:\d{1,2}x)?(\d{1,3}))?$/
const BARE_EPISODE = /^ep?(\d{1,4})(?:-e?p?(\d{1,4}))?$/
const ANIME_SEASON = /^tv-?(\d{1,2})$/
const VERSIONED = /^(\d{1,4})v\d$/

class Collector {
  seasons = new Set<number>()
  episodes?: EpisodeRange
  absolute?: AbsoluteRange
  complete = false
  ongoing = false

  private ctx: ParseContext

  constructor(ctx: ParseContext) {
    this.ctx = ctx
  }

  addSeasons(from: number, to: number, tokens: Token[], confidence: number) {
    if (from > 99)
      return
    for (const season of expand(from, to)) this.seasons.add(season)
    this.ctx.claim(tokens, 'seasons')
    this.ctx.setConfidence('seasons', confidence)
  }

  setEpisodes(
    from: number,
    to: number,
    unit: EpisodeUnit,
    tokens: Token[],
    confidence: number,
  ) {
    this.ctx.claim(tokens, 'episodes')
    if (this.episodes)
      return
    this.episodes = { from, to: Math.max(from, to), unit }
    this.ctx.setConfidence('episodes', confidence)
  }

  /** Число серий сезона из хвоста `из N` или `of N`. */
  attachTotal(after: Token) {
    const total = readTotal(this.ctx, after)
    if (!total)
      return
    this.ctx.claim(total.tokens, 'episodes')
    if (!this.episodes)
      return
    if (total.total === undefined)
      this.ongoing = true
    else if (this.episodes.total === undefined)
      this.episodes.total = total.total
  }
}

function sceneTokens(ctx: ParseContext, out: Collector) {
  for (const token of ctx.tokens) {
    if (token.kind !== 'word' || ctx.isClaimed(token))
      continue

    const episode = SCENE_EPISODE.exec(token.norm)
    if (episode) {
      const season = Number(episode[1])
      const numbers = [
        ...episode[3]!.matchAll(/(?:s\d{1,2})?e?(\d{1,4})/g),
      ].map(match => Number(match[1]))
      const from = Number(episode[2])
      out.addSeasons(season, season, [token], 1)
      out.setEpisodes(from, numbers.at(-1) ?? from, 'episode', [token], 1)
      if (episode[4] && out.episodes)
        out.episodes.total ??= Number(episode[4])
      out.attachTotal(token)
      continue
    }

    const season = SCENE_SEASON.exec(token.norm)
    if (season) {
      const from = Number(season[1])
      let to = season[2] ? Number(season[2]) : from
      const tokens = [token]
      // S01 - S03 через отдельный дефис
      const dash = ctx.next(token)
      const last = ctx.next(token, 2)
      const lastSeason = last && SCENE_SEASON.exec(last.norm)
      if (!season[2] && isPunct(dash, '-') && lastSeason && !lastSeason[2]) {
        to = Number(lastSeason[1])
        tokens.push(dash, last)
      }
      out.addSeasons(from, to, tokens, 1)
      continue
    }

    const cross = CROSS.exec(token.norm)
    if (cross) {
      const from = Number(cross[2])
      out.addSeasons(Number(cross[1]), Number(cross[1]), [token], 1)
      out.setEpisodes(
        from,
        cross[3] ? Number(cross[3]) : from,
        'episode',
        [token],
        1,
      )
      out.attachTotal(token)
      continue
    }

    const anime = ANIME_SEASON.exec(token.norm)
    if (anime) {
      out.addSeasons(Number(anime[1]), Number(anime[1]), [token], 0.9)
      continue
    }

    const bare = BARE_EPISODE.exec(token.norm)
    if (bare && token.index > 0) {
      const from = Number(bare[1])
      out.setEpisodes(
        from,
        bare[2] ? Number(bare[2]) : from,
        'episode',
        [token],
        0.8,
      )
      out.attachTotal(token)
    }
  }
}

interface Pair {
  keyword: Token
  unit: Keyword
  range: NumberRange
  /** Последний токен пары: от него читается хвост `из N`. */
  end: Token
}

function rangeBefore(
  ctx: ParseContext,
  keyword: Token,
): NumberRange | undefined {
  // Диапазон `1 - 8` занимает три токена: пробуем самый длинный вариант
  for (const offset of [3, 1]) {
    const start = ctx.prev(keyword, offset)
    const range = readRange(ctx, start)
    if (range && range.tokens.at(-1) === ctx.prev(keyword))
      return range
  }
  return undefined
}

function rangeAfter(
  ctx: ParseContext,
  keyword: Token,
): NumberRange | undefined {
  let next = ctx.next(keyword)
  if (isPunct(next, ':'))
    next = ctx.next(next)
  return readRange(ctx, next)
}

/**
 * Пары «ключевое слово + номер»: `Сезон: 1`, `1-3 сезоны`, `Серии 1-8`,
 * `01-10 серии`, `1 выпуск`. Порядок проходов разводит соседние пары вроде
 * `1 сезон 1-8 серия` и `Сезон 1 серии 1-8`.
 */
function keywordPairs(ctx: ParseContext): Pair[] {
  const keywords = ctx.tokens.filter(
    token =>
      token.kind === 'word' && KEYWORDS[token.norm] && !ctx.isClaimed(token),
  )
  const pairs: Pair[] = []
  const used = new Set<number>()
  const isFree = (range: NumberRange) =>
    range.tokens.every(
      token => !used.has(token.index) && !ctx.isClaimed(token),
    )
  const isKeyword = (token: Token | undefined) =>
    token !== undefined && KEYWORDS[token.norm] !== undefined
  const take = (keyword: Token, range: NumberRange, end: Token) => {
    for (const token of [keyword, ...range.tokens]) used.add(token.index)
    pairs.push({ keyword, unit: KEYWORDS[keyword.norm]!, range, end })
  }

  // 1. Номер перед словом, если сам номер не стоит сразу за другим ключевым словом
  for (const keyword of keywords) {
    const range = rangeBefore(ctx, keyword)
    if (range && isFree(range) && !isKeyword(ctx.prev(range.tokens[0]!)))
      take(keyword, range, keyword)
  }

  // 2. Номер после слова
  for (const keyword of keywords) {
    if (used.has(keyword.index))
      continue
    const range = rangeAfter(ctx, keyword)
    if (range && isFree(range))
      take(keyword, range, range.tokens.at(-1)!)
  }

  // 3. Оставшиеся номера перед словом
  for (const keyword of keywords) {
    if (used.has(keyword.index))
      continue
    const range = rangeBefore(ctx, keyword)
    if (range && isFree(range))
      take(keyword, range, keyword)
  }

  return pairs.sort((a, b) => a.keyword.index - b.keyword.index)
}

function keywordTokens(ctx: ParseContext, out: Collector) {
  for (const pair of keywordPairs(ctx)) {
    const tokens = [pair.keyword, ...pair.range.tokens]
    const colon = ctx.next(pair.keyword)
    if (isPunct(colon, ':'))
      tokens.push(colon)

    if (pair.unit === 'season') {
      out.addSeasons(pair.range.from, pair.range.to, tokens, 1)
      // Сезоны: 1, 2, 3
      let comma = ctx.next(pair.end)
      while (
        isPunct(comma, ',')
        && isNumber(ctx.next(comma))
        && Number(ctx.next(comma)!.norm) < 50
      ) {
        const item = ctx.next(comma)!
        out.addSeasons(Number(item.norm), Number(item.norm), [comma, item], 1)
        comma = ctx.next(item)
      }
      continue
    }

    out.setEpisodes(pair.range.from, pair.range.to, pair.unit, tokens, 1)
    out.attachTotal(pair.end)
  }
}

/**
 * Число или диапазон с хвостом `из N` без ключевого слова: `[1-10 из 12]`,
 * `[TV-1, 12 из 12]`. Одно число здесь — сколько серий вышло, то есть 1..N.
 */
function bareTotals(ctx: ParseContext, out: Collector) {
  for (const token of ctx.tokens) {
    if (ctx.isClaimed(token))
      continue
    const range = readRange(ctx, token)
    if (!range || range.tokens.some(item => ctx.isClaimed(item)))
      continue
    const end = range.tokens.at(-1)!
    const total = readTotal(ctx, end)
    if (!total)
      continue
    const single = range.from === range.to
    out.setEpisodes(
      single ? 1 : range.from,
      range.to,
      'episode',
      range.tokens,
      0.9,
    )
    out.attachTotal(end)
  }
}

function isAbsoluteCandidate(ctx: ParseContext, token: Token | undefined) {
  if (token?.kind !== 'word' || ctx.isClaimed(token))
    return undefined
  const versioned = VERSIONED.exec(token.norm)
  if (versioned) {
    return {
      from: Number(versioned[1]),
      to: Number(versioned[1]),
      tokens: [token],
    }
  }
  const range = readRange(ctx, token)
  if (
    !range
    || /[^\d-]/.test(token.norm)
    || (isYearLike(range.from) && isYearLike(range.to))
  ) {
    return undefined
  }
  return range
}

/**
 * Номер через дефис после названия, как в аниме-релизах: `Title - 05 [1080p]`,
 * `Title - 01-12`, или диапазон в отдельных скобках: `Title [01-12]`.
 * При известном сезоне это серии, без сезона — абсолютная нумерация.
 */
function dashNumbers(ctx: ParseContext, out: Collector) {
  if (out.episodes || out.absolute)
    return

  let found: NumberRange | undefined
  for (const token of ctx.tokens) {
    if (token.group !== undefined)
      continue
    if (isPunct(token, '-') && token.index > 0) {
      const range = isAbsoluteCandidate(ctx, ctx.next(token))
      if (range) {
        found = { ...range, tokens: [token, ...range.tokens] }
        break
      }
    }
  }

  if (!found) {
    for (const group of ctx.groups) {
      const tokens = ctx.groupTokens(group.id)
      const range = isAbsoluteCandidate(ctx, tokens[0])
      if (
        range
        && range.tokens.length === tokens.length
        && range.to > range.from
      ) {
        found = range
        break
      }
    }
  }

  if (!found)
    return

  if (out.seasons.size > 0) {
    out.setEpisodes(found.from, found.to, 'episode', found.tokens, 0.7)
    return
  }
  out.absolute = { from: found.from, to: found.to }
  ctx.claim(found.tokens, 'absolute')
  ctx.setConfidence('absolute', 0.6)
}

function markers(ctx: ParseContext, out: Collector) {
  for (const token of ctx.tokens) {
    if (token.kind !== 'word' || ctx.isClaimed(token))
      continue
    if (ONGOING.has(token.norm)) {
      out.ongoing = true
      ctx.claim(token, 'noise')
    }
    // complete season, полный сезон, все серии, все сезоны
    if (COMPLETE.has(token.norm)) {
      const next = ctx.next(token)
      const prev = ctx.prev(token)
      const near = [next, prev].find(
        item =>
          item
          && (KEYWORDS[item.norm]
            || item.norm === 'series'
            || item.norm === 'сериал'),
      )
      if (near || token.norm === 'complete') {
        out.complete = true
        ctx.claim(near ? [token, near] : token, 'noise')
      }
    }
  }
}

export function parseEpisodes(ctx: ParseContext): EpisodesResult {
  const out = new Collector(ctx)

  sceneTokens(ctx, out)
  keywordTokens(ctx, out)
  bareTotals(ctx, out)
  markers(ctx, out)
  dashNumbers(ctx, out)

  const episodes = out.episodes
  if (episodes?.total !== undefined && episodes.to < episodes.total)
    out.ongoing = true

  return {
    seasons: [...out.seasons].sort((a, b) => a - b),
    episodes,
    absolute: out.absolute,
    complete: out.complete,
    ongoing: out.ongoing,
  }
}
