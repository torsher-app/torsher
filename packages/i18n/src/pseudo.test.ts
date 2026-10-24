import { describe, expect, it } from 'vitest'
import enUS from './locales/en_US/ui.json' with { type: 'json' }
import { PSEUDO_PAD, pseudoLocalize, pseudoString } from './pseudo.ts'

function placeholders(message: string) {
  return message.match(/\{[^}]*\}/g) ?? []
}

describe('pseudoString', () => {
  it('ставит диакритику, скобки и добивку', () => {
    expect(pseudoString('Subtitles')).toBe('[Súbtítlés ẋẋẋẋ]')
  })

  it('не трогает подстановки', () => {
    expect(pseudoString('{n} of {total}')).toBe('[{n} óf {total} ẋẋ]')
    expect(pseudoString('Use {\'@\'}name')).toBe('[Üsé {\'@\'}ñámé ẋẋẋẋ]')
  })

  it('растягивает каждую форму множественного числа отдельно', () => {
    const forms = pseudoString('{n} season | {n} seasons').split(' | ')

    expect(forms).toEqual(['[{n} séásóñ ẋẋẋ]', '[{n} séásóñs ẋẋẋẋ]'])
  })

  it('кириллицу оставляет, но удлиняет', () => {
    expect(pseudoString('Аудио')).toBe('[Аудио ẋẋ]')
  })
})

describe('pseudoLocalize', () => {
  const pseudo = pseudoLocalize(enUS)

  function pairs(
    source: unknown,
    target: unknown,
    path = '',
  ): [string, string, string][] {
    if (typeof source === 'string')
      return [[path, source, target as string]]

    return Object.entries(source as Record<string, unknown>).flatMap(
      ([key, value]) =>
        pairs(
          value,
          (target as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        ),
    )
  }

  const all = pairs(enUS, pseudo)

  it('сохраняет ключи, подстановки и число форм каждой строки', () => {
    for (const [, source, target] of all) {
      expect(placeholders(target)).toEqual(placeholders(source))
      expect(target.split(' | ')).toHaveLength(source.split(' | ').length)
    }
  })

  it('делает каждую строку длиннее хотя бы на 40 %', () => {
    for (const [, source, target] of all) {
      for (const [index, form] of source.split(' | ').entries()) {
        const visible = form.replace(/\{[^}]*\}/g, '').length

        expect(target.split(' | ')[index]!.length).toBeGreaterThanOrEqual(
          form.length + visible * 0.4,
        )
      }
    }
  })

  it('отмечает строку добивкой', () => {
    expect(all.every(([, , target]) => target.includes(PSEUDO_PAD))).toBe(true)
  })
})
