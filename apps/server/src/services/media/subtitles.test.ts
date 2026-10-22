import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  convertSubtitle,
  decodeSubtitleText,
  findExternalSubtitles,
} from './subtitles.ts'
import { cuesInWindow, mergeCues, parseWebVtt } from './webvtt.ts'

const file = (path: string, size = 1000) => ({ path, size, padding: false })

describe('findExternalSubtitles', () => {
  it('то же имя с суффиксом языка рядом с фильмом', () => {
    const files = [
      file('Film (2024)/Film.2024.1080p.mkv', 5e9),
      file('Film (2024)/Film.2024.1080p.rus.srt'),
      file('Film (2024)/Film.2024.1080p.eng.forced.srt'),
      file('Film (2024)/Film.2024.1080p.nfo'),
    ]

    expect(findExternalSubtitles(files, 0)).toEqual([
      {
        fileIndex: 1,
        path: files[1]!.path,
        format: 'srt',
        language: 'rus',
        forced: false,
        title: null,
      },
      {
        fileIndex: 2,
        path: files[2]!.path,
        format: 'srt',
        language: 'eng',
        forced: true,
        title: 'forced',
      },
    ])
  })

  it('каталог субтитров у единственного видео, язык из имени каталога', () => {
    const files = [file('Film/Film.mkv', 5e9), file('Film/Rus Subs/Full.ass')]

    expect(findExternalSubtitles(files, 0)).toMatchObject([
      { fileIndex: 1, format: 'ass', language: 'rus', title: 'full' },
    ])
  })

  it('сэмпл не получает субтитры фильма', () => {
    const files = [
      file('Film/Film.Sample.mp4', 2e7),
      file('Film/Film.2024.1080p.mkv', 5e9),
      file('Film/Film.2024.1080p.rus.srt'),
    ]

    expect(findExternalSubtitles(files, 0)).toEqual([])
    expect(findExternalSubtitles(files, 1).map(sub => sub.fileIndex)).toEqual(
      [2],
    )
  })

  it('пометки без общих с видео слов имени', () => {
    const files = [
      file('Film/Film.2024.1080p.mkv', 5e9),
      file('Film/Film.2024.Rus.SDH.srt'),
    ]

    expect(findExternalSubtitles(files, 0)).toMatchObject([
      { language: 'rus', title: 'sdh' },
    ])
  })

  it('в паке сезона — только субтитры той же серии', () => {
    const files = [
      file('Show S01/Show.S01E01.mkv', 1e9),
      file('Show S01/Show.S01E02.mkv', 1e9),
      file('Show S01/Subs/Show.S01E01.srt'),
      file('Show S01/Subs/Show.S01E02.srt'),
    ]

    expect(findExternalSubtitles(files, 1).map(sub => sub.fileIndex)).toEqual(
      [3],
    )
  })
})

describe('decodeSubtitleText', () => {
  it('uTF-8 с BOM', () => {
    const bytes = new TextEncoder().encode('﻿Привет')

    expect(decodeSubtitleText(bytes)).toBe('Привет')
  })

  it('не UTF-8 — Windows-1251', () => {
    // «Привет» в Windows-1251
    const bytes = new Uint8Array([0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2])

    expect(decodeSubtitleText(bytes)).toBe('Привет')
  })
})

describe('webvtt', () => {
  const text
    = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nПервая\n\n00:01:00.000 --> 00:01:02.000\n<i>Вторая</i>\nстрока\n\n00:01:05.000 --> 00:01:06'

  it('разбирает реплики и пропускает недописанный хвост', () => {
    expect(parseWebVtt(text, false)).toEqual([
      { start: 1, end: 2.5, text: 'Первая' },
      { start: 60, end: 62, text: '<i>Вторая</i>\nстрока' },
    ])
  })

  it('окно и склейка проходов', () => {
    const cues = parseWebVtt(text, false)

    expect(cuesInWindow(cues, 2, 61).map(cue => cue.start)).toEqual([1, 60])
    expect(mergeCues([cues, cues.slice(1)])).toHaveLength(2)
  })
})

function hasFfmpeg() {
  // В `.env.test` ffmpeg нет нарочно: здесь нужен настоящий
  vi.stubEnv('FFMPEG_PATH', 'ffmpeg')
  vi.stubEnv('FFPROBE_PATH', 'ffprobe')

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

describe.runIf(hasFfmpeg())('convertSubtitle на ffmpeg', () => {
  it('sRT', async () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nРеплика\n\n'

    expect(await convertSubtitle(srt, 'srt')).toEqual([
      { start: 1, end: 2, text: 'Реплика' },
    ])
  })

  it('aSS без стилей', async () => {
    const ass = [
      '[Script Info]',
      'ScriptType: v4.00+',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:03.00,0:00:04.50,Default,,0,0,0,,{\\i1}Курсив{\\i0} и текст',
      '',
    ].join('\n')

    expect(await convertSubtitle(ass, 'ass')).toEqual([
      { start: 3, end: 4.5, text: '<i>Курсив</i> и текст' },
    ])
  })
})
