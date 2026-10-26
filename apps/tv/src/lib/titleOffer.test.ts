import type { TitleOfferInput } from './titleOffer.ts'
import { describe, expect, it } from 'vitest'
import { titleOffer } from './titleOffer.ts'

const catalog: TitleOfferInput = {
  hasSources: false,
  inLibrary: false,
  resume: false,
  followed: false,
  slot: 'start',
}

const everything = {
  watch: true,
  download: true,
  follow: true,
  sources: true,
  otherRelease: true,
}

describe('titleOffer', () => {
  it('с источниками и пока признак не пришёл — всё как раньше', () => {
    expect(titleOffer({ ...catalog, hasSources: true })).toEqual(everything)
    expect(titleOffer({ ...catalog, hasSources: undefined })).toEqual(
      everything,
    )
  })

  it('без источников у тайтла не из библиотеки нет пути к раздачам', () => {
    expect(titleOffer(catalog)).toEqual({
      watch: false,
      download: false,
      follow: false,
      sources: false,
      otherRelease: false,
    })
  })

  it('без источников тайтл из библиотеки смотрится, но не качается', () => {
    expect(titleOffer({ ...catalog, inLibrary: true, slot: 'none' })).toEqual({
      watch: true,
      download: false,
      follow: false,
      sources: false,
      otherRelease: false,
    })
  })

  it('без источников начатое остаётся: продолжить, закачка, подписка', () => {
    expect(
      titleOffer({ ...catalog, resume: true, followed: true, slot: 'active' }),
    ).toEqual({
      watch: true,
      download: true,
      follow: true,
      sources: false,
      otherRelease: false,
    })
  })
})
