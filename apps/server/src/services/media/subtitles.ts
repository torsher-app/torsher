import type { TorrentFileEntry } from '../../db/schema.ts'
import type { Cue } from './webvtt.ts'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { matchFiles } from '@torsher/release-parser'
import { config } from '../../config.ts'
import { parseWebVtt } from './webvtt.ts'

/** Внешние субтитры в раздаче рядом с видео */
export interface ExternalSubtitle {
  fileIndex: number
  path: string
  /** ISO 639-2, как у дорожек файла */
  language: string | null
  /** Пометки из имени: `Forced`, `SDH`, студия перевода */
  title: string | null
  format: 'srt' | 'ass' | 'webvtt'
  forced: boolean
}

const FORMATS: Record<string, ExternalSubtitle['format']> = {
  srt: 'srt',
  ass: 'ass',
  ssa: 'ass',
  vtt: 'webvtt',
}

const LANGUAGES: Record<string, string> = {
  rus: 'rus',
  ru: 'rus',
  russian: 'rus',
  рус: 'rus',
  русские: 'rus',
  русский: 'rus',
  eng: 'eng',
  en: 'eng',
  english: 'eng',
  англ: 'eng',
  английские: 'eng',
  ukr: 'ukr',
  uk: 'ukr',
  ua: 'ukr',
  ukrainian: 'ukr',
  укр: 'ukr',
}

// Слова пути, которые ничего не говорят о дорожке
const NOISE = new Set(['sub', 'subs', 'subtitle', 'subtitles', 'субтитры'])

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024
const CONVERT_TIMEOUT_MS = 30_000

function splitPath(path: string) {
  const parts = path.split('/')
  const name = parts.pop() ?? ''
  const dot = name.lastIndexOf('.')

  return {
    dir: parts.join('/'),
    stem: dot > 0 ? name.slice(0, dot) : name,
    ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
  }
}

function wordsOf(text: string) {
  return text
    .toLowerCase()
    .split(/[\s.\-_[\]()]+/)
    .filter(Boolean)
}

/** Слова имени субтитров после общих с именем видео: `Film.2024.Rus.srt` → `rus` */
function restOf(stem: string, videoStem: string) {
  const words = wordsOf(stem)
  const own = wordsOf(videoStem)
  let shared = 0

  while (shared < words.length && words[shared] === own[shared]) shared++

  return words.slice(shared)
}

/** Язык и пометки из того, чем имя субтитров отличается от имени видео */
function describe(rest: string[], dir: string) {
  const words = [...rest, ...wordsOf(dir.split('/').pop() ?? '')]
  const language = words.map(word => LANGUAGES[word]).find(Boolean) ?? null
  const forced = words.includes('forced')
  const title = rest
    .filter(word => !LANGUAGES[word] && !NOISE.has(word))
    .join(' ')

  return { language, forced, title: title || null }
}

/**
 * Субтитры к видео: то же имя с суффиксом (`Film.rus.srt`) или файлы в
 * каталоге субтитров рядом. В паке сезона — только той же серии.
 */
export function findExternalSubtitles(
  files: TorrentFileEntry[],
  videoIndex: number,
): ExternalSubtitle[] {
  const video = files[videoIndex]

  if (!video)
    return []

  const visible = files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => !file.padding)
  const matches = matchFiles(
    visible.map(({ file }) => ({ path: file.path, size: file.size })),
  )
  const videoMatch
    = matches[visible.findIndex(({ index }) => index === videoIndex)]
  // «Единственное видео» — только если это и есть смотримый файл: сэмпл или
  // второй ролик раздачи чужие субтитры не получают
  const onlyVideo
    = videoMatch?.kind === 'video'
      && matches.filter(match => match.kind === 'video').length === 1
  const own = splitPath(video.path)
  const found: ExternalSubtitle[] = []

  visible.forEach(({ file, index }, i) => {
    const match = matches[i]!
    const parts = splitPath(file.path)
    const format = FORMATS[parts.ext]

    if (!format || match.kind !== 'subtitle')
      return

    const sameName = parts.stem
      .toLowerCase()
      .startsWith(own.stem.toLowerCase())
    const nearby
      = parts.dir === own.dir
        || parts.dir.startsWith(`${own.dir}/`)
        || own.dir === ''
    const sameEpisode
      = videoMatch?.episode !== undefined && match.episode !== undefined
        ? videoMatch.episode === match.episode
        && (videoMatch.season ?? 0) === (match.season ?? videoMatch.season ?? 0)
        : undefined

    const belongs
      = sameName
        || (nearby && sameEpisode === true)
        || (nearby && sameEpisode === undefined && onlyVideo)

    if (!belongs || sameEpisode === false)
      return

    const meta = describe(
      restOf(parts.stem, own.stem),
      parts.dir === own.dir ? '' : parts.dir,
    )

    found.push({ fileIndex: index, path: file.path, format, ...meta })
  })

  return found
}

/**
 * Текст субтитров: UTF-8, иначе Windows-1251 — так пишут русские SRT.
 * BOM убирается.
 */
export function decodeSubtitleText(bytes: Uint8Array) {
  let text: string

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  catch {
    text = new TextDecoder('windows-1251').decode(bytes)
  }

  return text.replace(/^\uFEFF/, '')
}

/** SRT, ASS или WebVTT → реплики через ffmpeg (ASS теряет стили) */
export function convertSubtitle(
  text: string,
  format: ExternalSubtitle['format'],
) {
  return new Promise<Cue[]>((resolve, reject) => {
    const child = spawn(
      config.ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        format,
        '-i',
        'pipe:0',
        '-f',
        'webvtt',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: CONVERT_TIMEOUT_MS },
    )
    const output: Buffer[] = []
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-1000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0)
        resolve(parseWebVtt(Buffer.concat(output).toString('utf8')))
      else
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(text)
  })
}

/** Файл субтитров целиком из потока движка: он маленький */
export async function loadExternalSubtitle(
  url: string,
  subtitle: ExternalSubtitle,
) {
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${MAX_SUBTITLE_BYTES - 1}` },
    signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS * 4),
  })

  if (!response.ok)
    throw new Error(`Subtitle stream failed: ${response.status}`)

  const bytes = new Uint8Array(await response.arrayBuffer())

  return convertSubtitle(decodeSubtitleText(bytes), subtitle.format)
}
