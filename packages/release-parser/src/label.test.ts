import { describe, expect, it } from 'vitest'
import { parseAudioLabel } from './label.ts'

describe('parseAudioLabel', () => {
  it.each([
    ['LostFilm', { type: 'MVO', studio: 'LostFilm' }],
    ['MVO LostFilm', { type: 'MVO', studio: 'LostFilm' }],
    [
      'Многоголосый закадровый | NewStudio',
      { type: 'MVO', studio: 'NewStudio' },
    ],
    ['Дубляж', { type: 'D' }],
    ['Dub, Невафильм', { type: 'D', studio: 'Невафильм' }],
    ['Original', { type: 'Original' }],
    ['HDRezka Studio (MVO)', { type: 'MVO', studio: 'HDRezka Studio' }],
  ] as const)('%s', (label, track) => {
    expect(parseAudioLabel(label)).toEqual(track)
  })

  it.each(['Русский', 'English', 'Stereo', ''])(
    'без озвучки в названии: «%s»',
    (label) => {
      expect(parseAudioLabel(label)?.studio).toBeUndefined()
    },
  )
})
