import type { Language } from './language.ts'
import { describe, expect, it } from 'vitest'
import { attentionMessage } from './attention.ts'
import { followNotificationKinds, followNotificationText } from './follow.ts'
import { translate } from './format.ts'
import { messages } from './index.ts'

function textOf(language: Language) {
  return (
    key: string,
    params?: Record<string, string | number | undefined>,
    count?: number,
  ) => translate(messages, language, key, params, count)
}

const names = { ru_RU: 'Синтетика', en_US: 'Synthetic' }
// Полдень по местному времени: «до 20:00» того же дня — только часы
const now = new Date(2026, 9, 25, 12).getTime()

describe('followNotificationText', () => {
  it('«в библиотеке»: тайтл на языке канала, серии и общие факты', () => {
    expect(
      followNotificationText(textOf('ru_RU'), 'ru_RU', 'follow_downloaded', {
        names,
        episodes: 'S2E5–E7',
        count: 3,
        studio: 'Studio A',
        quality: '1080p',
      }),
    ).toEqual({
      title: 'Серии в библиотеке',
      text: '«Синтетика» · S2E5–E7 · Studio A · 1080p',
    })
    expect(
      followNotificationText(textOf('en_US'), 'en_US', 'follow_downloaded', {
        names,
        count: 1,
      }),
    ).toEqual({ title: 'Movie in the library', text: '“Synthetic”' })
  })

  it('«готова к просмотру»: серии, студия и качество выбранной раздачи', () => {
    expect(
      followNotificationText(textOf('ru_RU'), 'ru_RU', 'follow_ready', {
        names,
        episodes: 'S2E5',
        count: 1,
        studio: 'Studio A',
        quality: '1080p',
      }),
    ).toEqual({
      title: 'Серия готова к просмотру',
      text: '«Синтетика» · S2E5 · Studio A · 1080p',
    })
    expect(
      followNotificationText(textOf('en_US'), 'en_US', 'follow_ready', {
        names,
        count: 1,
      }),
    ).toEqual({ title: 'Movie ready to watch', text: '“Synthetic”' })
  })

  it('«ждём озвучку»: что вышло, чего ждём и до какого часа', () => {
    const until = new Date(2026, 9, 25, 20).toISOString()
    const { title, text } = followNotificationText(
      textOf('ru_RU'),
      'ru_RU',
      'follow_waiting',
      {
        names,
        episodes: 'S2E5',
        count: 1,
        studio: 'Studio B',
        wait: { studio: 'Studio A', quality: '1080p' },
        until,
      },
      now,
    )

    expect(title).toBe('Ждём вашу озвучку')
    expect(text).toBe(
      '«Синтетика» · S2E5 вышла в Studio B, ждём Studio A и 1080p до 20:00',
    )
  })

  it('ждём только качество — свой заголовок; тип озвучки — словом', () => {
    const result = followNotificationText(
      textOf('en_US'),
      'en_US',
      'follow_waiting',
      {
        names,
        episodes: 'S1E1–E2',
        count: 2,
        voiceType: 'MVO',
        wait: { quality: '1080p' },
        until: new Date(now + 60 * 60 * 1000).toISOString(),
      },
      now,
    )

    expect(result.title).toBe('Waiting for better quality')
    expect(result.text).toMatch(
      /^“Synthetic” · S1E1–E2 are out in Multi-voice; waiting for 1080p until /,
    )
  })

  it('«не нашли»: дни у одной серии, без них — общая фраза', () => {
    expect(
      followNotificationText(textOf('ru_RU'), 'ru_RU', 'follow_missing', {
        names,
        episodes: 'S1E3',
        count: 1,
        days: 62,
      }).text,
    ).toBe('«Синтетика» · S1E3 вышла 62 дня назад, а раздач так и нет')
    expect(
      followNotificationText(textOf('ru_RU'), 'ru_RU', 'follow_missing', {
        names,
        episodes: 'S1E3–E4',
        count: 2,
      }).text,
    ).toBe('«Синтетика» · S1E3–E4 вышли давно, а раздач так и нет')
  })

  it('тема: «из N», только конец диапазона или сезон', () => {
    const t = textOf('ru_RU')

    expect(
      followNotificationText(t, 'ru_RU', 'follow_topic_updated', {
        names,
        season: 2,
        episodesTo: 9,
        episodesTotal: 12,
      }).text,
    ).toBe('«Синтетика», сезон 2 — серии 1–9 из 12')
    expect(
      followNotificationText(t, 'ru_RU', 'follow_topic_updated', {
        names,
        season: 2,
      }).text,
    ).toBe('«Синтетика», сезон 2')
  })

  it('без названия тайтла — общая подпись, без ключей в тексте', () => {
    for (const language of ['ru_RU', 'en_US'] as const) {
      for (const kind of followNotificationKinds) {
        const { title, text } = followNotificationText(
          textOf(language),
          language,
          kind,
          { episodes: 'S1E1', count: 1, own: 'Studio A', season: 1 },
          now,
        )

        expect(title).not.toMatch(/notifications\.|\{/)
        expect(text).not.toMatch(/notifications\.|\{/)
      }
    }
  })
})

describe('follow_no_space', () => {
  it('с размером и без него', () => {
    const counted = attentionMessage({
      kind: 'follow_no_space',
      params: { count: 3, need: 12 },
    })
    const bare = attentionMessage({
      kind: 'follow_no_space',
      params: { count: 1 },
    })

    expect(
      translate(
        messages,
        'ru_RU',
        counted.key,
        { need: '12 ГБ' },
        counted.count,
      ),
    ).toBe('Не хватает места для 3 серий из «Слежу»: нужно 12 ГБ')
    expect(
      translate(messages, 'en_US', bare.key, bare.params, bare.count),
    ).toBe('Not enough space for 1 followed episode')
  })
})
