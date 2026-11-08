import { describe, expect, it } from 'vitest'
import { findStudio } from './studios.ts'
import { parseRelease } from './parse.ts'
import { searchStudios, studioKey, studios } from './studioSearch.ts'

function names(query: string) {
  return searchStudios(query, studios).map(item => item.studio.name)
}
describe('studio suggestions are separate from exact recognition', () => {
  it.each(['HDRezka', 'HD.Rezka_Studio', 'hdrezka-studio'])(
    'canonicalizes %s exactly',
    (query) => {
      expect(searchStudios(query, studios)[0]).toMatchObject({
        studio: { name: 'HDRezka Studio' },
        match: 'exact',
      })
    },
  )
  it('retains normalization and recognized short aliases', () => {
    expect(studioKey(' Михалёв._-')).toBe('михалев')
    expect(searchStudios('SDI', studios)[0]?.match).toBe('exact')
    expect(
      names('RedHeadSound').filter(name => name === 'Red Head Sound'),
    ).toHaveLength(1)
  })
  it.each(['HDRezka Studo', 'HDRezkaa Studio'])(
    'suggests one typo in %s without changing the parser',
    (query) => {
      expect(searchStudios(query, studios)).toContainEqual(
        expect.objectContaining({
          studio: expect.objectContaining({ name: 'HDRezka Studio' }),
          match: 'fuzzy',
        }),
      )
      expect(findStudio(query)).toBeUndefined()
    },
  )
  it('keeps parser behavior for an exact alias with a residual token', () => {
    const parsed = parseRelease(
      'Quiet Harbor (2024) S01E01 WEB-DL 1080p MVO HDRezka Studo',
    )
    expect(
      parsed.audio.some(audio => audio.studio === 'HDRezka Studio'),
    ).toBe(true)
    const typo = parseRelease(
      'Quiet Harbor (2024) S01E01 WEB-DL 1080p MVO HDRezkaa Studio',
    )
    expect(typo.audio.some(audio => audio.studio === 'HDRezka Studio')).toBe(
      false,
    )
  })
  it.each(['RHS', 'SDX', 'HDRezzkaa Studio', 'Unknown studio'])(
    'does not fuzzy-match %s',
    (query) => {
      expect(
        searchStudios(query, studios).filter(item => item.match === 'fuzzy'),
      ).toEqual([])
    },
  )
  it('orders exact, prefix, substring, fuzzy and canonically deduplicates aliases', () => {
    const collection = [
      { name: 'Zebra', aliases: ['Quieta'] },
      { name: 'Middle quiet' },
      { name: 'Quietly' },
      { name: 'Quiet' },
      { name: 'quiet', aliases: ['Quiet'] },
    ]
    expect(
      searchStudios('quiet', collection).map(item => [
        item.studio.name,
        item.match,
      ]),
    ).toEqual([
      ['Quiet', 'exact'],
      ['Quietly', 'prefix'],
      ['Zebra', 'prefix'],
      ['Middle quiet', 'substring'],
    ])
  })
  it('caps fuzzy suggestions at five with deterministic canonical ordering', () => {
    const collection = 'hgfedcba'
      .split('')
      .map(letter => ({ name: `voice${letter}` }))
    expect(
      searchStudios('voicex', collection).map(item => item.studio.name),
    ).toEqual(['voicea', 'voiceb', 'voicec', 'voiced', 'voicee'])
    expect(searchStudios('', collection)).toHaveLength(8)
    expect(
      searchStudios('', collection).every(item => item.match === 'browse'),
    ).toBe(true)
  })
  it('supports insertion, deletion and substitution only with both lengths at least five', () => {
    const collection = [{ name: 'abcde' }]
    for (const query of ['abxcde', 'abcxe', 'abcdef'])
      expect(searchStudios(query, collection)[0]?.match).toBe('fuzzy')
    expect(searchStudios('abde', collection)).toEqual([])
    expect(searchStudios('abxdxe', collection)).toEqual([])
  })
})
