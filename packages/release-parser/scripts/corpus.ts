import type { AudioTrack, ParsedRelease } from '../src/types.ts'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRelease } from '../src/parse.ts'
import { videoResolution } from '../src/resolution.ts'

export interface CorpusCase {
  title: string
  /** `seasons`, `episodes`, `quality`, `audio` обязательны; `null` — поля в названии нет. */
  expected: Record<string, unknown>
  note?: string
}

export interface CorpusFile {
  name: string
  cases: CorpusCase[]
}

/** Поля, по которым считается целевая точность. */
export const TARGET_FIELDS = [
  'seasons',
  'episodes',
  'quality',
  'audio',
] as const
/** Поля, которые сравниваются, только если кейс их размечает. */
export const EXTRA_FIELDS = [
  'year',
  'kind',
  'titles',
  'source',
  'absolute',
  'isOngoing',
  'resolution',
] as const
export const TARGET = 0.9

const CORPUS_DIR = join(import.meta.dirname, '..', 'corpus')

export function loadCorpus(): CorpusFile[] {
  return readdirSync(CORPUS_DIR)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => ({
      name: file,
      cases: JSON.parse(
        readFileSync(join(CORPUS_DIR, file), 'utf8'),
      ) as CorpusCase[],
    }))
}

function trackKey(track: AudioTrack) {
  return [track.type ?? '', track.studio ?? '', track.language ?? ''].join('|')
}

/** Значение поля в виде, который сравнивается со строкой ожидания. */
export function actualValue(parsed: ParsedRelease, field: string): unknown {
  switch (field) {
    case 'audio':
      return parsed.audio.map(trackKey).sort()
    case 'episodes':
    case 'absolute':
    case 'quality':
    case 'year':
    case 'source':
      return parsed[field] ?? null
    case 'resolution':
      return videoResolution(parsed) ?? null
    default:
      return parsed[field as keyof ParsedRelease]
  }
}

export function expectedValue(
  expected: Record<string, unknown>,
  field: string,
): unknown {
  const value = expected[field]
  if (field === 'audio')
    return (value as AudioTrack[]).map(trackKey).sort()
  return value ?? null
}

function canonical(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
  }
  return JSON.stringify(value)
}

export function isFieldCorrect(
  parsed: ParsedRelease,
  expected: Record<string, unknown>,
  field: string,
) {
  return (
    canonical(actualValue(parsed, field))
    === canonical(expectedValue(expected, field))
  )
}

export interface FieldStats {
  correct: number
  total: number
  errors: { file: string, title: string, expected: unknown, actual: unknown }[]
}

export function measure(files: CorpusFile[]) {
  const stats = new Map<string, FieldStats>()
  for (const field of [...TARGET_FIELDS, ...EXTRA_FIELDS])
    stats.set(field, { correct: 0, total: 0, errors: [] })

  for (const file of files) {
    for (const item of file.cases) {
      const parsed = parseRelease(item.title)
      for (const [field, stat] of stats) {
        if (!(field in item.expected))
          continue
        stat.total++
        if (isFieldCorrect(parsed, item.expected, field)) {
          stat.correct++
        }
        else {
          stat.errors.push({
            file: file.name,
            title: item.title,
            expected: expectedValue(item.expected, field),
            actual: actualValue(parsed, field),
          })
        }
      }
    }
  }
  return stats
}
