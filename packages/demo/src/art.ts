import type { DemoFont, DemoMotif, DemoTitle } from './titles'

/**
 * Рисованный арт демо-каталога: постеры (2:3), фоны и кадры серий (16:9),
 * логотипы названий. Всё рисуется здесь же и отдаётся data:-адресом: у демо
 * нет файлового сервера.
 *
 * `photo` — кадр фильма вместо рисунка. SVG, открытый через `<img>`, не
 * грузит внешние ресурсы, поэтому `photo` должен быть data:-адресом.
 */

type Palette = [string, string, string]

/** Детерминированный ГПСЧ: один и тот же тайтл всегда рисуется одинаково */
function rng(seed: string) {
  let state = 0
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) >>> 0

  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function escape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

function rgb(color: string): [number, number, number] {
  const n = Number.parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(from: string, to: string, amount: number) {
  const a = rgb(from)
  const b = rgb(to)
  const channel = (index: 0 | 1 | 2) =>
    Math.round(a[index] + (b[index] - a[index]) * amount)
      .toString(16)
      .padStart(2, '0')

  return `#${channel(0)}${channel(1)}${channel(2)}`
}

// Системные шрифты: веб-шрифты в SVG внутри <img> не подгружаются
const FONTS: Record<DemoFont, string> = {
  serif: `'Didot', 'Bodoni 72', 'Georgia', serif`,
  sans: `'Avenir Next Condensed', 'Futura', 'Helvetica Neue', sans-serif`,
  slab: `'Rockwell', 'American Typewriter', 'Georgia', serif`,
  round: `'Avenir Next', 'Futura', 'Helvetica Neue', sans-serif`,
}

function scene(
  motif: DemoMotif,
  [top, mid, low]: Palette,
  w: number,
  h: number,
  r: () => number,
) {
  const parts: string[] = []
  const dark = mix(top, '#000000', 0.55)

  const ridge = (base: number, amp: number, color: string, steps = 9) => {
    let d = `M0 ${h} L0 ${base}`
    for (let i = 1; i <= steps; i++) {
      const x = (w / steps) * i
      const y = base - amp * (0.3 + r() * 0.9) * (i % 2 ? 1 : 0.45)
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`
    }
    return `<path d="${d} L${w} ${h} Z" fill="${color}"/>`
  }

  const glow = (cx: number, cy: number, rad: number, color: string) =>
    `<circle cx="${cx}" cy="${cy}" r="${rad * 2.4}" fill="url(#halo)"/><circle cx="${cx}" cy="${cy}" r="${rad}" fill="${color}"/>`

  const stars = (count: number, maxY: number) => {
    let s = ''
    for (let i = 0; i < count; i++)
      s += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * maxY).toFixed(1)}" r="${(0.6 + r() * 1.6).toFixed(2)}" fill="#fff" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`
    return s
  }

  switch (motif) {
    case 'mountains':
      parts.push(
        stars(40, h * 0.4),
        glow(
          w * (0.3 + r() * 0.4),
          h * 0.34,
          w * 0.07,
          mix(low, '#ffffff', 0.5),
        ),
      )
      parts.push(
        ridge(h * 0.62, h * 0.22, mix(mid, top, 0.3)),
        ridge(h * 0.72, h * 0.16, mix(top, '#000000', 0.25)),
        ridge(h * 0.84, h * 0.1, dark),
      )
      break
    case 'sea': {
      parts.push(glow(w * 0.62, h * 0.42, w * 0.11, mix(low, '#ffffff', 0.35)))
      for (let i = 0; i < 7; i++) {
        const y = h * (0.55 + i * 0.065)
        let d = `M0 ${y}`
        for (let x = 0; x <= w; x += w / 8)
          d += ` Q${x + w / 16} ${y - 10 - r() * 14} ${x + w / 8} ${y}`
        parts.push(
          `<path d="${d} L${w} ${h} L0 ${h} Z" fill="${mix(mid, '#000000', 0.15 + i * 0.1)}" opacity="0.9"/>`,
        )
      }
      break
    }
    case 'city': {
      parts.push(
        stars(30, h * 0.35),
        glow(w * 0.25, h * 0.28, w * 0.05, mix(low, '#ffffff', 0.6)),
      )
      for (let layer = 0; layer < 2; layer++) {
        let x = -10
        while (x < w) {
          const bw = w * (0.05 + r() * 0.09)
          const bh = h * (0.18 + r() * 0.32) * (layer ? 0.75 : 1)
          const color = layer ? dark : mix(mid, '#000000', 0.4)
          parts.push(
            `<rect x="${x.toFixed(1)}" y="${(h * 0.86 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${(bh + h).toFixed(1)}" fill="${color}"/>`,
          )
          for (let k = 0; k < 6; k++) {
            if (r() < 0.55) {
              parts.push(
                `<rect x="${(x + bw * 0.2 + r() * bw * 0.5).toFixed(1)}" y="${(h * 0.86 - bh + 8 + r() * bh * 0.8).toFixed(1)}" width="${(w * 0.008).toFixed(1)}" height="${(w * 0.012).toFixed(1)}" fill="${low}" opacity="${layer ? 0.9 : 0.5}"/>`,
              )
            }
          }
          x += bw + 2
        }
      }
      parts.push(
        `<rect y="${h * 0.86}" width="${w}" height="${h}" fill="${dark}"/>`,
      )
      break
    }
    case 'orchard': {
      parts.push(glow(w * 0.5, h * 0.4, w * 0.16, mix(low, '#ffffff', 0.3)))
      parts.push(
        `<rect y="${h * 0.7}" width="${w}" height="${h}" fill="${mix(mid, '#000000', 0.45)}"/>`,
      )
      for (let i = 0; i < 9; i++) {
        const x = w * (0.04 + i * 0.12 + r() * 0.04)
        const s = w * (0.05 + r() * 0.04)
        const y = h * (0.66 + r() * 0.04)
        parts.push(
          `<rect x="${x - 2}" y="${y}" width="4" height="${s * 1.2}" fill="${dark}"/><circle cx="${x}" cy="${y - s * 0.4}" r="${s}" fill="${mix(mid, '#000000', 0.25 + r() * 0.25)}"/>`,
        )
      }
      break
    }
    case 'kites': {
      parts.push(glow(w * 0.7, h * 0.3, w * 0.1, mix(low, '#ffffff', 0.4)))
      for (let i = 0; i < 6; i++) {
        const x = w * (0.1 + r() * 0.8)
        const y = h * (0.12 + r() * 0.45)
        const s = w * (0.025 + r() * 0.04)
        parts.push(
          `<path d="M${x} ${y - s} L${x + s * 0.7} ${y} L${x} ${y + s * 1.4} L${x - s * 0.7} ${y} Z" fill="${mix(low, '#ffffff', r() * 0.4)}" opacity="0.9"/><path d="M${x} ${y + s * 1.4} q${s} ${s * 2} 0 ${s * 4}" stroke="${low}" stroke-width="1.5" fill="none" opacity="0.6"/>`,
        )
      }
      parts.push(
        `<path d="M0 ${h * 0.78} Q${w * 0.3} ${h * 0.7} ${w * 0.55} ${h * 0.77} T${w} ${h * 0.74} L${w} ${h} L0 ${h} Z" fill="${mix(mid, '#000000', 0.2)}"/>`,
      )
      parts.push(
        `<path d="M0 ${h * 0.86} Q${w * 0.4} ${h * 0.8} ${w} ${h * 0.88} L${w} ${h} L0 ${h} Z" fill="${dark}"/>`,
      )
      break
    }
    case 'orbit': {
      parts.push(stars(90, h))
      const cx = w * 0.5
      const cy = h * 0.42
      const rad = w * 0.2
      for (let i = 1; i <= 4; i++) {
        parts.push(
          `<ellipse cx="${cx}" cy="${cy}" rx="${rad * (1 + i * 0.45)}" ry="${rad * (0.35 + i * 0.14)}" fill="none" stroke="${low}" stroke-width="1.6" opacity="${0.55 - i * 0.1}" transform="rotate(-14 ${cx} ${cy})"/>`,
        )
      }
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#planet)"/>`,
      )
      parts.push(
        `<circle cx="${cx + rad * 1.7}" cy="${cy - rad * 0.5}" r="${rad * 0.12}" fill="${mix(low, '#ffffff', 0.5)}"/>`,
      )
      break
    }
    case 'lighthouse': {
      parts.push(stars(50, h * 0.5))
      const x = w * 0.62
      parts.push(
        `<path d="M${x} ${h * 0.38} L${x - w * 0.9} ${h * 0.2} L${x - w * 0.9} ${h * 0.5} Z" fill="${mix(low, '#ffffff', 0.5)}" opacity="0.18"/>`,
      )
      parts.push(
        `<path d="M${x - w * 0.035} ${h * 0.4} L${x + w * 0.035} ${h * 0.4} L${x + w * 0.055} ${h * 0.75} L${x - w * 0.055} ${h * 0.75} Z" fill="${mix(mid, '#000000', 0.5)}"/>`,
      )
      parts.push(glow(x, h * 0.38, w * 0.022, mix(low, '#ffffff', 0.6)))
      parts.push(ridge(h * 0.78, h * 0.06, dark, 6))
      parts.push(
        `<rect y="${h * 0.84}" width="${w}" height="${h}" fill="${mix(top, '#000000', 0.4)}"/>`,
      )
      break
    }
    case 'storm': {
      for (let i = 0; i < 5; i++) {
        parts.push(
          `<ellipse cx="${(r() * w).toFixed(1)}" cy="${(h * (0.12 + r() * 0.25)).toFixed(1)}" rx="${w * (0.3 + r() * 0.3)}" ry="${h * (0.06 + r() * 0.05)}" fill="${mix(top, '#000000', 0.2 + r() * 0.3)}" opacity="0.85"/>`,
        )
      }
      const x = w * (0.35 + r() * 0.3)
      parts.push(
        `<path d="M${x} ${h * 0.3} l${-w * 0.05} ${h * 0.14} l${w * 0.04} 0 l${-w * 0.06} ${h * 0.16}" stroke="${mix(low, '#ffffff', 0.6)}" stroke-width="3" fill="none"/>`,
      )
      parts.push(
        `<path d="M0 ${h * 0.8} L${w} ${h * 0.76} L${w} ${h} L0 ${h} Z" fill="${dark}"/>`,
      )
      break
    }
    case 'forest': {
      parts.push(glow(w * 0.5, h * 0.3, w * 0.08, mix(low, '#ffffff', 0.6)))
      for (let layer = 0; layer < 3; layer++) {
        const base = h * (0.62 + layer * 0.1)
        const color = mix(mid, '#000000', 0.25 + layer * 0.25)
        let x = -20
        while (x < w + 20) {
          const s = w * (0.04 + r() * 0.05)
          const th = h * (0.12 + r() * 0.12)
          parts.push(
            `<path d="M${x} ${base - th} L${x + s} ${base} L${x - s} ${base} Z" fill="${color}"/>`,
          )
          x += s * (1.1 + r() * 0.6)
        }
        parts.push(
          `<rect y="${base - 1}" width="${w}" height="${h}" fill="${color}"/>`,
        )
      }
      break
    }
  }

  return parts.join('')
}

function defs([top, mid, low]: Palette) {
  return `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.55" stop-color="${mid}"/><stop offset="1" stop-color="${low}"/></linearGradient>
<radialGradient id="halo"><stop offset="0" stop-color="${mix(low, '#ffffff', 0.5)}" stop-opacity="0.55"/><stop offset="1" stop-color="${low}" stop-opacity="0"/></radialGradient>
<radialGradient id="planet" cx="0.35" cy="0.3"><stop offset="0" stop-color="${mix(low, '#ffffff', 0.3)}"/><stop offset="0.7" stop-color="${mid}"/><stop offset="1" stop-color="${mix(top, '#000000', 0.4)}"/></radialGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.3" stop-color="#000" stop-opacity="0"/><stop offset="0.75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0"/></filter>
</defs>`
}

/** Перенос по словам: строки не длиннее `max` символов, если слово влезает */
function wrap(text: string, max: number) {
  const lines: string[] = []
  for (const word of text.split(' ')) {
    const line = lines.at(-1)
    if (line === undefined || `${line} ${word}`.length > max)
      lines.push(word)
    else lines[lines.length - 1] = `${line} ${word}`
  }
  return lines
}

const toUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

function photoLayer(photo: string, w: number, h: number) {
  return `<image href="${photo}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
}

export function posterUrl(title: DemoTitle, photo?: string) {
  const w = 400
  const h = 600
  const lines = wrap(
    title.title.toUpperCase(),
    title.font === 'serif' ? 13 : 12,
  )
  const size
    = lines.length > 2 ? 34 : lines.some(line => line.length > 10) ? 38 : 46
  const baseY = 62 + size
  const sans = title.font === 'sans'
  const text = lines
    .map(
      (line, index) =>
        `<text x="${w / 2}" y="${baseY + index * size * 1.05}" text-anchor="middle" font-family="${FONTS[title.font]}" font-size="${size}" font-weight="${sans ? 600 : 400}" letter-spacing="${sans ? 3 : 2}" fill="#f6efe4" stroke="rgba(0,0,0,0.35)" stroke-width="3" paint-order="stroke">${escape(line)}</text>`,
    )
    .join('')
  const art = photo
    ? photoLayer(photo, w, h)
    : `<rect width="${w}" height="${h}" fill="url(#sky)"/>${scene(title.motif, title.art, w, h, rng(title.id))}`

  return toUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 1.5}" height="${h * 1.5}">${defs(title.art)}
${art}
<rect width="${w}" height="${h}" fill="url(#fade)"/><rect width="${w}" height="${h}" filter="url(#grain)"/>
<text x="${w / 2}" y="${baseY + (lines.length - 1) * size * 1.05 + 30}" text-anchor="middle" font-family="${FONTS.round}" font-size="13" letter-spacing="5" fill="#f6efe4" opacity="0.75">${escape(title.tagline ?? '')}</text>
${text}</svg>`)
}

/** Фон 16:9; `seed` даёт другой рисунок того же тайтла */
export function backdropUrl(title: DemoTitle, seed = '', photo?: string) {
  const w = 1920
  const h = 1080
  const art = photo
    ? photoLayer(photo, w, h)
    : `<rect width="${w}" height="${h}" fill="url(#sky)"/>${scene(title.motif, title.art, w, h, rng(title.id + seed))}<rect width="${w}" height="${h}" filter="url(#grain)"/>`

  return toUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs(title.art)}
${art}</svg>`,
  )
}

const STILL_MOTIFS: DemoMotif[] = [
  'mountains',
  'sea',
  'forest',
  'city',
  'storm',
]

/** Кадр серии: тот же мир, но палитра и сюжет сдвинуты от серии к серии */
export function stillUrl(title: DemoTitle, season: number, episode: number) {
  const shift = ((season * 7 + episode * 3) % 10) / 22
  const [top, mid, low] = title.art
  const art: Palette = [
    mix(top, '#000000', shift / 2),
    mix(mid, low, shift),
    mix(low, '#ffffff', shift / 3),
  ]
  const motifs = [title.motif, ...STILL_MOTIFS]
  const motif = motifs[(season + episode) % motifs.length]!
  const w = 640
  const h = 360
  const r = rng(`${title.id}:${season}:${episode}`)

  return toUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs(art)}
<rect width="${w}" height="${h}" fill="url(#sky)"/>${scene(motif, art, w, h, r)}<rect width="${w}" height="${h}" filter="url(#grain)"/></svg>`)
}

// Средняя ширина буквы капсом в долях кегля: по ней считается ширина SVG
const GLYPH_WIDTH: Record<DemoFont, number> = {
  serif: 0.82,
  sans: 0.6,
  slab: 0.78,
  round: 0.72,
}

/** Логотип-название на прозрачном фоне */
export function logoUrl(title: DemoTitle) {
  const lines = wrap(title.title.toUpperCase(), 16)
  const size = 92
  const sans = title.font === 'sans'
  const spacing = sans ? 6 : 4
  const longest = Math.max(...lines.map(line => line.length))
  const w = Math.ceil(longest * (size * GLYPH_WIDTH[title.font] + spacing))
  const h = Math.ceil(lines.length * size * 1.02 + size * 0.28)
  const text = lines
    .map(
      (line, index) =>
        `<text x="0" y="${(index + 1) * size * 1.02}" font-family="${FONTS[title.font]}" font-size="${size}" font-weight="${sans ? 600 : 400}" letter-spacing="${spacing}" fill="#f6efe4">${escape(line)}</text>`,
    )
    .join('')

  return toUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${text}</svg>`,
  )
}
