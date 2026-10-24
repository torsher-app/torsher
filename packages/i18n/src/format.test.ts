import { describe, expect, it } from 'vitest'
import { attentionMessage } from './attention.ts'
import { translate } from './format.ts'
import { messages } from './index.ts'

describe('translate', () => {
  it('подставляет параметры и число', () => {
    expect(
      translate(
        messages,
        'en_US',
        'notifications.events.update_available.title',
        { version: '0.4.0' },
      ),
    ).toBe('Torsher 0.4.0 is available')
    expect(
      translate(messages, 'ru_RU', 'notifications.overflow.text', {}, 3),
    ).toBe('Ещё 3 уведомления — в панели')
    expect(
      translate(messages, 'ru_RU', 'notifications.overflow.text', {}, 21),
    ).toBe('Ещё 21 уведомление — в панели')
    expect(
      translate(messages, 'en_US', 'notifications.overflow.text', {}, 1),
    ).toBe('1 more notification is in the panel')
    expect(
      translate(messages, 'en_US', 'notifications.overflow.text', {}, 5),
    ).toBe('5 more notifications are in the panel')
  })

  it('без строки возвращает ключ', () => {
    expect(translate(messages, 'ru_RU', 'notifications.nope')).toBe(
      'notifications.nope',
    )
  })
})

describe('attentionMessage', () => {
  it('один элемент — по имени, несколько — числом', () => {
    const one = attentionMessage({
      kind: 'indexer_error',
      params: { count: 1, name: 'Local' },
    })
    const many = attentionMessage({
      kind: 'indexer_error',
      params: { count: 3 },
    })

    expect(translate(messages, 'ru_RU', one.key, one.params, one.count)).toBe(
      'Индексатор «Local» не отвечает или отклоняет запросы',
    )
    expect(
      translate(messages, 'ru_RU', many.key, many.params, many.count),
    ).toBe('3 индексатора не отвечают или отклоняют запросы')
  })

  it('у движка и ключа TMDB текст — по причине', () => {
    const message = attentionMessage({
      kind: 'engine_down',
      params: { reason: 'stopped' },
    })

    expect(translate(messages, 'en_US', message.key)).not.toBe(message.key)
  })

  it('сбой копии: нехватка места с цифрами, без цифр — общая фраза', () => {
    const counted = attentionMessage({
      kind: 'backup_failed',
      params: { reason: 'no_space', need: 3, free: 1 },
    })
    const bare = attentionMessage({
      kind: 'backup_failed',
      params: { reason: 'no_space' },
    })

    expect(counted).toEqual({
      key: 'panel.overview.attention.backup_failed.no_space',
      params: { need: 3, free: 1 },
    })
    expect(translate(messages, 'ru_RU', bare.key)).toBe(
      'Резервная копия не сделана: не хватает места на диске',
    )
  })
})
