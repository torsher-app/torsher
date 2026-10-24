import { describe, expect, it } from 'vitest'
import {
  activeCues,
  audioOrder,
  channelsLabel,
  codecLabel,
  heardStudio,
  kilobits,
  subtitleHtml,
} from './tracks.ts'

describe('студия, которую слышно', () => {
  const track = { language: 'rus', studio: null, voiceType: null }
  const lostfilm = { type: 'MVO' as const, studio: 'LostFilm' }

  it('из названия дорожки', () => {
    expect(
      heardStudio({ ...track, studio: 'Кубик в Кубе', voiceType: 'MVO' }, lostfilm),
    ).toBe('Кубик в Кубе')
  })

  it('дорожка без названия на языке озвучки — студия раздачи', () => {
    expect(heardStudio(track, lostfilm)).toBe('LostFilm')
    expect(
      heardStudio({ ...track, language: 'ukr' }, { ...lostfilm, language: 'uk' }),
    ).toBe('LostFilm')
  })

  it('оригинал, другой язык или тип в названии — не студия раздачи', () => {
    expect(heardStudio({ ...track, language: 'eng' }, lostfilm)).toBeUndefined()
    expect(
      heardStudio({ ...track, voiceType: 'Original' }, lostfilm),
    ).toBeUndefined()
    expect(heardStudio(track, { type: 'D' })).toBeUndefined()
    expect(heardStudio(undefined, lostfilm)).toBeUndefined()
  })
})

describe('подписи дорожек', () => {
  it('кодек как в раздачах', () => {
    expect(codecLabel('eac3')).toBe('E-AC3')
    expect(codecLabel('truehd')).toBe('TrueHD')
    expect(codecLabel('alac')).toBe('ALAC')
  })

  it('каналы', () => {
    expect(channelsLabel(6)).toBe('5.1')
    expect(channelsLabel(8)).toBe('7.1')
    expect(channelsLabel(2)).toBe('2.0')
    expect(channelsLabel(null)).toBeNull()
  })

  it('битрейт и порядок дорожек', () => {
    expect(kilobits(384_000)).toBe(384)
    expect(kilobits(null)).toBeNull()

    const track = {
      language: null,
      title: null,
      codec: 'ac3',
      channels: 6,
      bitrate: null,
      default: false,
      studio: null,
      voiceType: null,
    }

    expect(
      audioOrder(
        [
          { ...track, index: 1 },
          { ...track, index: 3 },
        ],
        3,
      ),
    ).toBe(1)
  })
})

describe('реплики субтитров', () => {
  it('оставляет курсив и экранирует остальное', () => {
    expect(
      subtitleHtml(
        '<i>Курсив</i> & <font color="red">цвет</font>\nстрока <script>x</script>',
      ),
    ).toBe('<i>Курсив</i> &amp; цвет<br>строка x')
  })

  it('видимые в момент реплики', () => {
    const cues = [
      { start: 1, end: 3, text: 'a' },
      { start: 2, end: 4, text: 'b' },
      { start: 5, end: 6, text: 'c' },
    ]

    expect(activeCues(cues, 2.5).map(cue => cue.text)).toEqual(['a', 'b'])
    expect(activeCues(cues, 4.5)).toEqual([])
  })
})
