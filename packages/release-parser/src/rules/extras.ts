import type { ParseContext } from '../context.ts'
import type { Token } from '../tokenize.ts'
import type { ReleaseKind } from '../types.ts'
import { isTag } from './quality.ts'

/** Понятные теги, которые в результат не попадают: звук, флаги релиза, издания, сервисы. */
const NOISE = new Set([
  'aac',
  'ac3',
  'eac3',
  'e-ac3',
  'dts',
  'dts-hd',
  'dts-x',
  'ma',
  'truehd',
  'atmos',
  'flac',
  'mp3',
  'opus',
  'lpcm',
  'pcm',
  'dd',
  'ddp',
  'dd+',
  'dd5.1',
  'ddp5.1',
  'ddp2.0',
  'dd2.0',
  'aac2.0',
  'aac5.1',
  '5.1',
  '7.1',
  '2.0',
  '1.0',
  '2ch',
  '6ch',
  '8ch',
  'proper',
  'repack',
  'rerip',
  'internal',
  'limited',
  'readnfo',
  'multi',
  'dual',
  'extended',
  'unrated',
  'uncut',
  'remastered',
  'theatrical',
  'imax',
  'hybrid',
  'sdr',
  '10bit',
  '10-bit',
  '8bit',
  'hi10p',
  'hi10',
  '60fps',
  'amzn',
  'nf',
  'dsnp',
  'atvp',
  'hmax',
  'hulu',
  'pcok',
  'okko',
  'kp',
  'kinopoisk',
  'кинопоиск',
  'ivi',
  'wink',
  'premier',
  'mkv',
  'mp4',
  'avi',
  'rip',
  'обновлено',
  'updated',
  'версия',
  'режиссерская',
  'расширенная',
])

const NOISE_PAIRS = [
  ['open', 'matte'],
  ['director\'s', 'cut'],
  ['directors', 'cut'],
]

// Звук с каналами, в том числе разорванный пробелом: `DDP5.1`, `AAC2 0`
const AUDIO_CODEC = /^(?:ddp?|e?ac3|aac|dts|truehd|flac|opus)\d(?:\.\d)?$/
// Контрольная сумма аниме-релиза в скобках: `[ABCD1234]`
const CRC = /^[0-9a-f]{8}$/

const SERIES_WORDS = new Set([
  'tv',
  'сериал',
  'мини-сериал',
  'мультсериал',
  'телесериал',
  'series',
  'miniseries',
  'mini-series',
  'tv-series',
  'тв-шоу',
  'шоу',
  'дорама',
  'ova',
  'ona',
])
const MOVIE_WORDS = new Set([
  'фильм',
  'мультфильм',
  'кинофильм',
  'movie',
  'film',
])

/** Шумовые теги ищем только после названия: `Proper` или `Max` бывают и словами названия. */
export function claimNoise(ctx: ParseContext, titleEnd: number) {
  for (const token of ctx.tokens) {
    if (
      token.kind !== 'word'
      || ctx.isClaimed(token)
      || (token.index < titleEnd && token.group === undefined)
    ) {
      continue
    }
    const next = ctx.next(token)
    if (
      NOISE.has(token.norm)
      || (token.group !== undefined
        && CRC.test(token.norm)
        && ctx.groupTokens(token.group).length === 1)
    ) {
      ctx.claim(token, 'noise')
    }
    if (AUDIO_CODEC.test(token.norm)) {
      ctx.claim(token, 'noise')
      if (next && /^\d$/.test(next.norm) && !token.norm.includes('.'))
        ctx.claim(next, 'noise')
    }
    for (const [first, second] of NOISE_PAIRS) {
      if (token.norm === first && next?.norm === second)
        ctx.claim([token, next], 'noise')
    }
  }
}

/**
 * Релиз-группа: хвост `-GRP` scene-имени (`x264-GRP`, `H.264-GRP`) или группа
 * в квадратных скобках в самом начале (`[Group] Title - 05`).
 */
export function parseGroup(ctx: ParseContext): string | undefined {
  const leading = ctx.groups[0]
  if (leading?.kind === 'square' && leading.start === 0) {
    const tokens = ctx.groupTokensDeep(leading.id)
    const rest = ctx.tokens.filter(token => token.group === undefined)
    if (
      tokens.length > 0
      && rest.length > 0
      && tokens.every(
        token =>
          !ctx.isClaimed(token) || ctx.claims.get(token.index) === 'noise',
      )
    ) {
      ctx.claim(tokens, 'group')
      return ctx.raw.slice(leading.start + 1, leading.end).trim()
    }
  }

  const last = ctx.tokens.findLast(
    token =>
      token.kind === 'word' && token.group === undefined && !token.afterPipe,
  )
  if (!last)
    return undefined

  if (last.value.startsWith('-') && last.value.length > 1 && last.index > 0) {
    ctx.claims.set(last.index, 'group')
    return last.value.slice(1)
  }

  const parts = last.value.split('-')
  const tail = parts.at(-1)!
  const head = parts.slice(0, -1).join('-').toLowerCase()
  if (
    parts.length > 1
    && tail
    && !isTag(last.norm)
    && !isTag(tail.toLowerCase())
    && (isTag(head) || NOISE.has(head) || /^(?:h\.?)?26[45]$/.test(head))
  ) {
    ctx.claim(last, 'group')
    return tail
  }

  return undefined
}

/**
 * Скобка с годом и перечнем через запятую — служебная: `[2024, США, драма, WEB-DL 1080p]`.
 * Страны и жанры в ней не нужны, но и «непонятыми» не считаются.
 */
export function claimInfoBrackets(ctx: ParseContext) {
  for (const group of ctx.groups) {
    const tokens = ctx.groupTokens(group.id)
    const hasYear = tokens.some(
      token => ctx.claims.get(token.index) === 'year',
    )
    const hasList = tokens.some(
      token => token.kind === 'punct' && token.value === ',',
    )
    if (hasYear && hasList) {
      ctx.claim(
        tokens.filter(token => !ctx.isClaimed(token)),
        'info',
      )
    }
  }
}

/** Слова «сериал», «фильм» в скобках или после названия. */
export function parseKindHint(
  ctx: ParseContext,
  titleEnd: number,
): ReleaseKind | undefined {
  let hint: ReleaseKind | undefined
  const consider = (token: Token) =>
    token.group !== undefined || token.index >= titleEnd
  for (const token of ctx.tokens) {
    if (token.kind !== 'word' || !consider(token))
      continue
    const claim = ctx.claims.get(token.index)
    if (claim && claim !== 'info')
      continue
    const kind = SERIES_WORDS.has(token.norm)
      ? 'series'
      : MOVIE_WORDS.has(token.norm)
        ? 'movie'
        : undefined
    if (kind) {
      hint ??= kind
      ctx.claims.set(token.index, 'kind')
    }
  }
  return hint
}
