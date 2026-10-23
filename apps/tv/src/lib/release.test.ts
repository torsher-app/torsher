import { describe, expect, it } from 'vitest'
import { releaseFacts, suggestionName } from './release.ts'

describe('карточка нераспознанной раздачи', () => {
  it('подсказка — название и год, без года — только название', () => {
    expect(suggestionName({ title: 'Example Show', year: 2024 })).toBe(
      'Example Show, 2024',
    )
    expect(suggestionName({ title: 'Example Show' })).toBe('Example Show')
  })

  it('сериал: сезоны и серии, без сезонов — файлы', () => {
    expect(releaseFacts({ seasons: [3], videos: 1, size: 10 })).toEqual({
      coverage: 'S3',
      count: 1,
      countKey: 'release.episodes',
      size: 10,
    })
    expect(
      releaseFacts({ seasons: [1, 2], videos: 9, size: 10 }).coverage,
    ).toBe('S1–2')
    expect(releaseFacts({ seasons: [], videos: 1, size: 10 })).toMatchObject({
      coverage: '',
      countKey: 'release.files',
    })
  })
})
