import type { ParseContext } from '../context.ts'
import type { Token } from '../tokenize.ts'
import type { Codec, Hdr, Resolution, Source } from '../types.ts'

export interface QualityResult {
  quality?: Resolution
  source?: Source
  codec?: Codec
  hdr: Hdr[]
}

const RESOLUTIONS: Record<string, Resolution> = {
  '2160p': '2160p',
  '4k': '2160p',
  'uhd': '2160p',
  '1440p': '1440p',
  '1080p': '1080p',
  'fullhd': '1080p',
  'fhd': '1080p',
  '1080i': '1080i',
  '720p': '720p',
  '576p': '576p',
  '576i': '576p',
  '480p': '480p',
  '480i': '480p',
  '360p': '360p',
}

// Ширина кадра из `1920x1080` в класс разрешения
const FRAME_HEIGHTS: [number, Resolution][] = [
  [2000, '2160p'],
  [1400, '1440p'],
  [1000, '1080p'],
  [700, '720p'],
  [560, '576p'],
  [460, '480p'],
]

const SOURCES: Record<string, Source> = {
  'web-dl': 'WEB-DL',
  'webdl': 'WEB-DL',
  'web': 'WEB-DL',
  'web-dlrip': 'WEB-DLRip',
  'webdlrip': 'WEB-DLRip',
  'webrip': 'WEBRip',
  'web-rip': 'WEBRip',
  'bdremux': 'BDRemux',
  'remux': 'BDRemux',
  'bdrip': 'BDRip',
  'brrip': 'BDRip',
  'bd-rip': 'BDRip',
  'bluray': 'Blu-ray',
  'blu-ray': 'Blu-ray',
  'bd': 'Blu-ray',
  'bdmv': 'Blu-ray',
  'hdrip': 'HDRip',
  'hdtv': 'HDTV',
  'hdtvrip': 'HDTVRip',
  'hdtv-rip': 'HDTVRip',
  'satrip': 'SATRip',
  'sat-rip': 'SATRip',
  'iptv': 'IPTV',
  'iptvrip': 'IPTV',
  'tvrip': 'TVRip',
  'tv-rip': 'TVRip',
  'dvb': 'DVB',
  'dvbrip': 'DVB',
  'dvdrip': 'DVDRip',
  'dvd-rip': 'DVDRip',
  'dvd': 'DVD',
  'dvd5': 'DVD',
  'dvd9': 'DVD',
  'ts': 'TS',
  'hdts': 'TS',
  'telesync': 'TS',
  'camrip': 'CAMRip',
  'cam': 'CAMRip',
  'hdcam': 'CAMRip',
}

// Чем точнее источник, тем выше: `Blu-ray Remux` — это BDRemux, а не Blu-ray
const SOURCE_RANK: Partial<Record<Source, number>> = {
  'BDRemux': 3,
  'WEB-DLRip': 2,
  'BDRip': 2,
  'WEBRip': 2,
}

const CODECS: Record<string, Codec> = {
  'x264': 'H.264',
  'h264': 'H.264',
  'h.264': 'H.264',
  'avc': 'H.264',
  'x265': 'H.265',
  'h265': 'H.265',
  'h.265': 'H.265',
  'hevc': 'H.265',
  'av1': 'AV1',
  'vp9': 'VP9',
  'xvid': 'XviD',
  'divx': 'DivX',
  'mpeg-2': 'MPEG-2',
  'mpeg2': 'MPEG-2',
  'vc-1': 'VC-1',
  'vc1': 'VC-1',
}

const HDRS: Record<string, Hdr> = {
  'hdr': 'HDR10',
  'hdr10': 'HDR10',
  'hdr10+': 'HDR10+',
  'hdr10plus': 'HDR10+',
  'dv': 'DV',
  'dovi': 'DV',
  'hlg': 'HLG',
}

// Короткие теги, которые бывают обычными словами названия (`The Web`, `DV`)
const RISKY = new Set([
  'web',
  'ts',
  'bd',
  'cam',
  'dv',
  'uhd',
  'dvd',
  'hdr',
  'remux',
  'hdtv',
])

export function isTag(word: string) {
  return (
    word in RESOLUTIONS || word in SOURCES || word in CODECS || word in HDRS
  )
}

/**
 * Слово целиком и его части через дефис, от длинных к коротким:
 * `WEB-DLRip-AVC` → `web-dlrip`, `dlrip-avc`, `web`, `dlrip`, `avc`.
 */
function variants(token: Token) {
  const parts = token.norm.split('-').filter(Boolean)
  const result = [token.norm]
  for (let size = parts.length - 1; size >= 1; size--) {
    for (let start = 0; start + size <= parts.length; start++)
      result.push(parts.slice(start, start + size).join('-'))
  }
  return result
}

function frameResolution(norm: string): Resolution | undefined {
  const match = /^\d{3,4}x(\d{3,4})$/.exec(norm)
  if (!match)
    return undefined
  const height = Number(match[1])
  return FRAME_HEIGHTS.find(([min]) => height >= min)?.[1]
}

export function parseQuality(ctx: ParseContext): QualityResult {
  const result: QualityResult = { hdr: [] }

  for (const token of ctx.tokens) {
    if (token.kind !== 'word' || ctx.isClaimed(token))
      continue

    // Рискованный тег считаем тегом, только если рядом уже есть разобранное или другой тег
    const anchored
      = ctx.tokens.slice(0, token.index).some(item => ctx.isClaimed(item))
        || variants(ctx.next(token) ?? token).some(
          word => word !== token.norm && isTag(word),
        )
    const leading = token.index === 0 || (RISKY.has(token.norm) && !anchored)
    let matched = false

    for (const word of variants(token)) {
      const resolution = RESOLUTIONS[word] ?? frameResolution(word)
      if (resolution && !(leading && RISKY.has(word))) {
        if (!result.quality) {
          result.quality = resolution
          ctx.setConfidence(
            'quality',
            word === '4k' || word === 'uhd' ? 0.9 : 1,
          )
        }
        matched = true
        continue
      }

      const source = SOURCES[word]
      if (source && !leading) {
        if (
          !result.source
          || (SOURCE_RANK[source] ?? 1) > (SOURCE_RANK[result.source] ?? 1)
        ) {
          result.source = source
        }
        ctx.setConfidence('source', 1)
        matched = true
        continue
      }

      const codec = CODECS[word]
      if (codec && !leading) {
        result.codec ??= codec
        ctx.setConfidence('codec', 1)
        matched = true
        continue
      }

      const hdr = HDRS[word]
      if (hdr && !leading) {
        if (!result.hdr.includes(hdr))
          result.hdr.push(hdr)
        matched = true
      }
    }

    // WEB DL и Dolby Vision пишут и двумя словами, а `+` у HDR10+ токенизатор отделяет
    const next = ctx.next(token)
    // `H 264` — scene-имя, где точки заменили пробелами
    if (token.norm === 'h' && next && /^26[45](?:-|$)/.test(next.norm)) {
      result.codec ??= next.norm.startsWith('264') ? 'H.264' : 'H.265'
      ctx.setConfidence('codec', 1)
      ctx.claim([token, next], 'quality')
    }
    if (
      token.norm === 'hdr10'
      && next?.value === '+'
      && next.start === token.end
    ) {
      result.hdr = result.hdr.filter(item => item !== 'HDR10')
      result.hdr.push('HDR10+')
      ctx.claim(next, 'quality')
    }
    if (token.norm === 'web' && next?.norm === 'dl') {
      result.source = 'WEB-DL'
      ctx.claim(next, 'source')
    }
    if (token.norm === 'dolby' && next?.norm === 'vision') {
      if (!result.hdr.includes('DV'))
        result.hdr.push('DV')
      ctx.claim([token, next], 'noise')
    }

    if (matched)
      ctx.claim(token, 'quality')
  }

  // HDR10 вместе с HDR10+ избыточен
  if (result.hdr.includes('HDR10+'))
    result.hdr = result.hdr.filter(item => item !== 'HDR10')

  return result
}
