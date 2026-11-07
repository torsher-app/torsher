import type { AudioStreamInfo, MediaInfo } from './probe.ts'
import { expect, it } from 'vitest'
import {
  audioPreferenceOf,
  matchesAudio,
  preferredSubtitle,
} from './trackPreferences.ts'
import { pickAudioStream } from './decide.ts'

function track(
  index: number,
  title: string,
  language = 'rus',
): AudioStreamInfo {
  return {
    index,
    title,
    language,
    codec: 'aac',
    channels: 2,
    bitrate: null,
    default: index === 1,
  }
}
const dubbed = audioPreferenceOf(track(3, 'Дубляж'))
const media: MediaInfo = {
  container: 'mkv',
  duration: 660,
  video: null,
  audio: [
    track(1, 'MVO LostFilm'),
    track(5, 'Дубляж'),
    track(2, 'Original', 'eng'),
  ],
  subtitles: [],
}

it('carries dubbing by type and language rather than an index or the old studio', () => {
  expect(dubbed).toEqual({ studio: null, voiceType: 'D', language: 'rus' })
  expect(pickAudioStream(media, { selected: dubbed, studio: 'LostFilm' })).toBe(
    5,
  )
  expect(
    pickAudioStream(
      { ...media, audio: [track(9, 'Дубляж'), track(3, 'MVO LostFilm')] },
      { selected: dubbed },
    ),
  ).toBe(9)
})
it('keeps original language ahead of a profile locale and never confirms missing metadata', () => {
  const original = audioPreferenceOf(track(2, 'Original', 'eng'))
  expect(pickAudioStream(media, { selected: original, locale: 'ru_RU' })).toBe(
    2,
  )
  expect(
    matchesAudio(track(1, '', 'eng'), {
      language: null,
      studio: null,
      voiceType: null,
    }),
  ).toBe(false)
})
it('matches subtitle language and forced intent across reordered files and honours off', () => {
  const withSubs: MediaInfo = {
    ...media,
    subtitles: [
      {
        index: 4,
        language: 'eng',
        title: null,
        codec: 'subrip',
        forced: true,
        default: true,
        text: true,
        image: false,
      },
      {
        index: 9,
        language: 'en',
        title: null,
        codec: 'subrip',
        forced: false,
        default: false,
        text: true,
        image: false,
      },
    ],
  }
  const preference = { enabled: true, language: 'eng', forced: false }
  expect(preferredSubtitle(withSubs, [], preference)).toBe('s9')
  expect(
    preferredSubtitle(withSubs, [], { ...preference, enabled: false }),
  ).toBeNull()
  expect(
    preferredSubtitle(withSubs, [], { ...preference, language: 'rus' }),
  ).toBeNull()
})

const selectedStudio = audioPreferenceOf(track(2, 'MVO Red Head Sound'))

it('prefers the saved studio with unknown voice type over another studio in the same language', () => {
  const unknown = track(7, 'Red Head Sound')
  expect(
    pickAudioStream(
      { ...media, audio: [track(1, 'MVO NewStudio'), unknown] },
      {
        selected: selectedStudio,
      },
    ),
  ).toBe(7)
  // The fallback must not claim that the unknown type was confirmed.
  expect(matchesAudio(unknown, selectedStudio)).toBe(false)
  expect(selectedStudio.voiceType).toBe('MVO')
})

it('prefers an exact match even when an unknown-type studio track comes first', () => {
  expect(
    pickAudioStream(
      {
        ...media,
        audio: [track(1, 'Red Head Sound'), track(8, 'MVO Red Head Sound')],
      },
      { selected: selectedStudio },
    ),
  ).toBe(8)
})

it.each([
  ['Dub Red Head Sound', 'rus'],
  ['Red Head Sound', 'eng'],
  ['Red Head Sound', 'und'],
  ['Pazl Voice', 'rus'],
])(
  'does not prefer conflicting or unconfirmed metadata: %s / %s',
  (title, language) => {
    expect(
      pickAudioStream(
        {
          ...media,
          audio: [track(1, 'MVO NewStudio'), track(7, title, language)],
        },
        { selected: selectedStudio },
      ),
    ).toBe(1)
  },
)

it('does not relax a type-only preference without a saved studio', () => {
  const unknown = track(7, 'Red Head Sound')
  expect(
    pickAudioStream(
      { ...media, audio: [track(1, 'MVO NewStudio'), unknown] },
      {
        selected: dubbed,
      },
    ),
  ).toBe(1)
})

it('recognizes the dictionary voice type when a LostFilm label omits it', () => {
  const selected = audioPreferenceOf(track(4, 'MVO LostFilm'))
  const next = track(7, 'LostFilm [1080p]')
  expect(matchesAudio(next, selected)).toBe(true)
  expect(
    pickAudioStream(
      { ...media, audio: [track(1, 'MVO NewStudio'), next] },
      {
        selected,
      },
    ),
  ).toBe(7)
})
