import type { Claim } from './context.ts'
import type { ParsedRelease, ReleaseKind } from './types.ts'
import { ParseContext } from './context.ts'
import { parseAudio } from './rules/audio.ts'
import { parseEpisodes } from './rules/episodes.ts'
import {
  claimInfoBrackets,
  claimNoise,
  parseGroup,
  parseKindHint,
} from './rules/extras.ts'
import { parseQuality } from './rules/quality.ts'
import { parseTitles } from './rules/titles.ts'
import { parseYear } from './rules/year.ts'
import { findStudio } from './studios.ts'
import { tokenize } from './tokenize.ts'

const STRUCTURAL = new Set<Claim>([
  'seasons',
  'episodes',
  'absolute',
  'year',
  'quality',
])

/**
 * Где кончается название: первый разобранный токен, `|` верхнего уровня
 * или квадратная скобка, кроме фансаб-группы в начале.
 */
function findTitleEnd(ctx: ParseContext) {
  const end = ctx.tokens.findIndex((token) => {
    const claim = ctx.claims.get(token.index)
    if (claim && STRUCTURAL.has(claim))
      return true
    if (
      token.kind === 'punct'
      && token.value === '|'
      && token.group === undefined
    ) {
      return true
    }
    return (
      token.group !== undefined
      && ctx.groups[token.group]!.kind === 'square'
      && claim !== 'group'
    )
  })
  return end === -1 ? ctx.tokens.length : end
}

/** Непонятые слова, склеенные в фрагменты исходной строки. */
function collectUnparsed(ctx: ParseContext) {
  const fragments: string[] = []
  let run:
    { start: number, end: number, index: number, group?: number } | undefined

  const flush = () => {
    if (run)
      fragments.push(ctx.raw.slice(run.start, run.end))
    run = undefined
  }

  for (const token of ctx.tokens) {
    if (token.kind !== 'word' || ctx.isClaimed(token)) {
      if (token.kind === 'word' || ctx.isClaimed(token))
        flush()
      continue
    }
    if (run && run.group === token.group && token.index <= run.index + 2) {
      run.end = token.end
      run.index = token.index
      continue
    }
    flush()
    run = {
      start: token.start,
      end: token.end,
      index: token.index,
      group: token.group,
    }
  }
  flush()
  return fragments
}

/** Разбирает название раздачи: русские форматы и scene-имена. */
export function parseRelease(title: string): ParsedRelease {
  const ctx = new ParseContext(tokenize(title))

  const year = parseYear(ctx)
  const episodes = parseEpisodes(ctx)
  const quality = parseQuality(ctx)
  const group = parseGroup(ctx)
  const titleEnd = findTitleEnd(ctx)
  claimNoise(ctx, titleEnd)
  const { audio, subs } = parseAudio(ctx, titleEnd)
  claimInfoBrackets(ctx)
  const kindHint = parseKindHint(ctx, titleEnd)
  const titles = parseTitles(ctx, titleEnd)

  // Релиз-группа, которая сама студия озвучки: `...WEB-DL.1080p-LostFilm`
  const groupStudio = group ? findStudio(group) : undefined
  if (groupStudio && !audio.some(track => track.studio === groupStudio.name)) {
    audio.push(
      groupStudio.type
        ? { type: groupStudio.type, studio: groupStudio.name }
        : { studio: groupStudio.name },
    )
  }

  const { seasons, episodes: range, absolute, complete } = episodes
  const seriesMarkers
    = seasons.length > 0
      || range !== undefined
      || absolute !== undefined
      || complete
  let kind: ReleaseKind = 'unknown'
  if (seriesMarkers || kindHint === 'series') {
    kind = 'series'
    ctx.setConfidence('kind', seriesMarkers ? 1 : 0.8)
  }
  else if (kindHint === 'movie' || year !== undefined) {
    kind = 'movie'
    ctx.setConfidence('kind', kindHint === 'movie' ? 0.8 : 0.6)
  }

  const isPack
    = kind === 'series'
      && (seasons.length > 1
        || (range !== undefined && range.to > range.from)
        || (absolute !== undefined && absolute.to > absolute.from)
        || complete
        || (seasons.length === 1 && !range && !absolute))

  return {
    raw: title,
    titles,
    year,
    kind,
    seasons,
    episodes: range,
    absolute,
    quality: quality.quality,
    source: quality.source,
    codec: quality.codec,
    hdr: quality.hdr,
    audio,
    subs,
    group,
    isPack,
    isOngoing: kind === 'series' && episodes.ongoing,
    confidence: ctx.confidence,
    unparsed: collectUnparsed(ctx),
  }
}
