export interface Cue {
  /** Секунды от начала файла */
  start: number
  end: number
  text: string
}

const TIMING
  = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/

function seconds(h: string | undefined, m: string, s: string, ms: string) {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
}

/**
 * Реплики WebVTT, который пишет ffmpeg. Незаконченный хвост (ffmpeg ещё
 * пишет файл) пропускается: реплика без пустой строки после неё может быть
 * не дописана.
 */
export function parseWebVtt(text: string, complete = true): Cue[] {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)

  if (!complete)
    blocks.pop()

  const cues: Cue[] = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const timingAt = lines.findIndex(line => line.includes('-->'))
    const match = timingAt >= 0 ? TIMING.exec(lines[timingAt]!.trim()) : null

    if (!match)
      continue

    const body = lines
      .slice(timingAt + 1)
      .join('\n')
      .trim()

    if (!body)
      continue

    cues.push({
      start: seconds(match[1], match[2]!, match[3]!, match[4]!),
      end: seconds(match[5], match[6]!, match[7]!, match[8]!),
      text: body,
    })
  }

  return cues
}

/** Реплики, которые видны в окне `[from, to)` */
export function cuesInWindow(cues: Cue[], from: number, to: number) {
  return cues.filter(cue => cue.end > from && cue.start < to)
}

/** Склейка реплик из нескольких проходов ffmpeg: без повторов, по времени */
export function mergeCues(lists: Cue[][]) {
  const seen = new Set<string>()
  const merged: Cue[] = []

  for (const cue of lists.flat()) {
    const key = `${cue.start.toFixed(3)}|${cue.text}`

    if (seen.has(key))
      continue
    seen.add(key)
    merged.push(cue)
  }

  return merged.sort((a, b) => a.start - b.start)
}
