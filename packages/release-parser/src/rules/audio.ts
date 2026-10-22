import type { ParseContext } from '../context.ts'
import type { Token } from '../tokenize.ts'
import type { AudioChannels, AudioTrack, VoiceType } from '../types.ts'
import { findStudio, studioMaxWords } from '../studios.ts'

export interface AudioResult {
  audio: AudioTrack[]
  subs: string[]
}

// Маркеры после `|`: одной буквой их можно читать только там
const PIPE_MARKERS: Record<string, VoiceType> = {
  d: 'D',
  p: 'MVO',
  p2: 'DVO',
  p1: 'VO',
  a: 'AVO',
  l: 'L',
  l2: 'L',
  l1: 'L',
}

const VOICE_WORDS: Record<string, VoiceType> = {
  dub: 'D',
  dubbed: 'D',
  дубляж: 'D',
  дублированный: 'D',
  mvo: 'MVO',
  многоголосый: 'MVO',
  dvo: 'DVO',
  двухголосый: 'DVO',
  vo: 'VO',
  одноголосый: 'VO',
  avo: 'AVO',
  авторский: 'AVO',
  любительский: 'L',
  профессиональный: 'MVO',
}

// После «профессиональный» или «авторский» уточнение числа голосов
const VOICE_COUNTS: Record<string, VoiceType> = {
  многоголосый: 'MVO',
  двухголосый: 'DVO',
  одноголосый: 'VO',
}

const LANGUAGES: Record<string, string> = {
  rus: 'ru',
  ru: 'ru',
  russian: 'ru',
  русский: 'ru',
  eng: 'en',
  en: 'en',
  english: 'en',
  английский: 'en',
  ukr: 'uk',
  ua: 'uk',
  укр: 'uk',
  украинский: 'uk',
  jap: 'ja',
  jpn: 'ja',
  японский: 'ja',
  ger: 'de',
  deu: 'de',
  fre: 'fr',
  fra: 'fr',
  spa: 'es',
  ita: 'it',
  kor: 'ko',
  chi: 'zh',
}

const ORIGINAL = new Set(['original', 'orig', 'оригинал', 'оригинальная'])
const SUBS = new Set([
  'sub',
  'subs',
  'субтитры',
  'hardsub',
  'softsub',
  'sub-rus',
  'sub-eng',
])
const NOISE = new Set([
  'закадровый',
  'лицензия',
  'line',
  'itunes',
  'чистый',
  'звук',
])

type Item
  = | { kind: 'voice', type: VoiceType, tokens: Token[] }
    | { kind: 'studio', name: string, type?: VoiceType, tokens: Token[] }
    | { kind: 'original', tokens: Token[] }
    | { kind: 'language', code: string, subtitle: boolean, tokens: Token[] }
    | { kind: 'subs', tokens: Token[] }
    | { kind: 'break', strong: boolean, tokens: Token[] }
    | { kind: 'noise', tokens: Token[] }

function voiceAt(ctx: ParseContext, token: Token): Item | undefined {
  const marker = token.afterPipe ? PIPE_MARKERS[token.norm] : undefined
  if (marker)
    return { kind: 'voice', type: marker, tokens: [token] }

  const type = VOICE_WORDS[token.norm]
  if (!type)
    return undefined

  // «Профессиональный (многоголосый)», «Любительский (одноголосый)»: уточнение — часть того же маркера
  const tokens = [token]
  let resolved = type
  for (let offset = 1; offset <= 2; offset++) {
    const next = ctx.tokens[token.index + offset]
    if (next?.kind !== 'word')
      break
    const count = VOICE_COUNTS[next.norm]
    if (count) {
      tokens.push(next)
      if (type === 'MVO' && token.norm === 'профессиональный')
        resolved = count
      break
    }
  }
  return { kind: 'voice', type: resolved, tokens }
}

/** Самое длинное написание студии из подряд идущих слов одной группы. */
function studioAt(ctx: ParseContext, token: Token): Item | undefined {
  for (let size = studioMaxWords; size >= 1; size--) {
    const words = ctx.tokens.slice(token.index, token.index + size)
    if (
      words.length < size
      || words.some(
        word =>
          word.kind !== 'word'
          || word.group !== token.group
          || ctx.isClaimed(word),
      )
    ) {
      continue
    }
    const studio = findStudio(words.map(word => word.value).join(' '))
    if (studio) {
      return {
        kind: 'studio',
        name: studio.name,
        type: studio.type,
        tokens: words,
      }
    }
  }
  return undefined
}

// `| SDR-Jaskier`: студия склеена с тегом через дефис, а релиз-группу после `|` не ищут
const TAGGED_STUDIO = /^(?:sdr|hdr|hdr10|dv)-(.+)$/

function taggedStudioAt(token: Token): Item | undefined {
  if (!token.afterPipe || token.kind !== 'word')
    return undefined

  const glued = TAGGED_STUDIO.exec(token.norm)
  const studio = glued ? findStudio(glued[1]!) : undefined

  return studio
    ? { kind: 'studio', name: studio.name, type: studio.type, tokens: [token] }
    : undefined
}

function itemAt(ctx: ParseContext, token: Token): Item | undefined {
  if (token.kind === 'punct') {
    if (token.value === '+' || token.value === '|' || token.value === ';')
      return { kind: 'break', strong: true, tokens: [] }
    if (token.value === ',' || token.value === '/')
      return { kind: 'break', strong: token.group === undefined, tokens: [] }
    return undefined
  }

  const studio = studioAt(ctx, token) ?? taggedStudioAt(token)
  if (studio)
    return studio

  const voice = voiceAt(ctx, token)
  if (voice)
    return voice

  // «от LostFilm»
  const next = ctx.tokens[token.index + 1]
  if (token.norm === 'от' && next && studioAt(ctx, next))
    return { kind: 'noise', tokens: [token] }

  if (ORIGINAL.has(token.norm))
    return { kind: 'original', tokens: [token] }
  if (SUBS.has(token.norm))
    return { kind: 'subs', tokens: [token] }
  if (NOISE.has(token.norm))
    return { kind: 'noise', tokens: [token] }

  const code = LANGUAGES[token.norm]
  if (code) {
    return {
      kind: 'language',
      code,
      subtitle: next !== undefined && SUBS.has(next.norm),
      tokens: [token],
    }
  }
  return undefined
}

function sameTrack(a: AudioTrack, b: AudioTrack) {
  return (
    a.type === b.type && a.studio === b.studio && a.language === b.language
  )
}

/**
 * Озвучка и субтитры из хвоста названия: маркеры после `|` (`D`, `P`, `A`, `L`),
 * `Dub`, `MVO (LostFilm, NewStudio)`, `+ Original + Sub (Rus, Eng)`, студии без типа.
 * `from` — первый токен после названия: в самом названии озвучку не ищем.
 */
export function parseAudio(ctx: ParseContext, from: number): AudioResult {
  const audio: AudioTrack[] = []
  const subs: string[] = []
  let current: AudioTrack | undefined
  // Группа сразу за маркером типа: студии в ней получают этот тип
  let typedGroup: { id: number, type: VoiceType } | undefined
  let inSubs = false
  let subsFound = false
  // `| P | LostFilm`: студия в следующем блоке после `|` уточняет голый тип
  let typeBeforePipe: AudioTrack | undefined

  const add = (track: AudioTrack) => {
    audio.push(track)
    current = track
  }

  for (let i = from; i < ctx.tokens.length; i++) {
    const token = ctx.tokens[i]!
    if (ctx.isClaimed(token))
      continue
    const item = itemAt(ctx, token)
    if (!item)
      continue
    ctx.claim(item.tokens, item.kind === 'noise' ? 'noise' : 'audio')
    i = Math.max(i, item.tokens.at(-1)?.index ?? i)

    const pipeType = typeBeforePipe
    if (item.kind !== 'break')
      typeBeforePipe = undefined

    switch (item.kind) {
      case 'break':
        if (item.strong) {
          typeBeforePipe
            = token.value === '|'
              && current?.type
              && !current.studio
              && !current.language
              ? current
              : undefined
          current = undefined
          inSubs = false
        }
        break
      case 'voice': {
        add({ type: item.type })
        inSubs = false
        const group = ctx.groupRightAfter(item.tokens.at(-1)!)
        typedGroup = group && { id: group.id, type: item.type }
        break
      }
      case 'studio': {
        const typed
          = typedGroup && token.group === typedGroup.id
            ? typedGroup.type
            : undefined
        current ??= pipeType
        if (
          current
          && !current.studio
          && !current.language
          && current.type !== 'Original'
          && !inSubs
        ) {
          current.studio = item.name
        }
        else if (typed) {
          add({ type: typed, studio: item.name })
        }
        else {
          add({ type: item.type, studio: item.name })
        }
        current!.type ??= item.type
        inSubs = false
        break
      }
      case 'original':
        add({ type: 'Original' })
        inSubs = false
        break
      case 'subs':
        inSubs = true
        subsFound = true
        break
      case 'language':
        if (item.subtitle || inSubs) {
          subs.push(item.code)
          subsFound = true
        }
        else if (current && !current.language) {
          current.language = item.code
        }
        else {
          add({ language: item.code })
        }
        break
    }
  }

  if (subsFound && subs.length === 0)
    subs.push('und')

  const tracks = audio.filter(
    (track, i) => audio.findIndex(other => sameTrack(other, track)) === i,
  )

  if (tracks.length > 0) {
    ctx.setConfidence(
      'audio',
      tracks.some(track => track.type && track.studio) ? 1 : 0.8,
    )
  }

  return {
    audio: tracks.map(
      track =>
        Object.fromEntries(
          Object.entries(track).filter(([, value]) => value !== undefined),
        ) as AudioTrack,
    ),
    subs: [...new Set(subs)],
  }
}

// `5.1`, `DDP5.1`, `AAC2.0`: каналы в конце тега
const CHANNELS = /(?:^|[a-z])([257]\.[01])$/
const CHANNEL_ORDER: AudioChannels[] = ['2.0', '5.1', '7.1']

/**
 * Каналы звука из тегов после названия — наибольшие из указанных. Токены не
 * забирает: `5.1` бывает частью тега, который уже разобрал другой шаг.
 */
export function parseChannels(
  ctx: ParseContext,
  from: number,
): AudioChannels | undefined {
  let best = -1

  for (const token of ctx.tokens.slice(from)) {
    const found = token.kind === 'word' ? CHANNELS.exec(token.norm) : null
    const index = found ? CHANNEL_ORDER.indexOf(found[1] as AudioChannels) : -1

    if (index > best)
      best = index
  }

  return best >= 0 ? CHANNEL_ORDER[best] : undefined
}
