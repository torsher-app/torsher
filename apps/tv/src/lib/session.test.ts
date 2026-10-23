import type { Profile } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { autoProfile, gateTarget, safeNext } from './session.ts'

function route(fullPath: string) {
  const [path = '', search = ''] = fullPath.split('?')

  return {
    path,
    fullPath,
    query: Object.fromEntries(new URLSearchParams(search).entries()),
  }
}

function profile(id: string, hasPin = false): Profile {
  return {
    id,
    name: id,
    color: 'violet',
    language: null,
    hasPin,
    ageLimit: null,
    posterRatings: ['tmdb'],
    player: { autoNext: true, subtitleSize: 'm', subtitleBackground: 'box' },
  }
}

describe('gateTarget', () => {
  it('без подключения уводит на экран кода и помнит, куда шли', () => {
    expect(gateTarget('unpaired', route('/'))).toEqual({
      path: '/connect',
      query: undefined,
    })
    expect(gateTarget('unpaired', route('/play/t1/0?title=x'))).toEqual({
      path: '/connect',
      query: { next: '/play/t1/0?title=x' },
    })
    expect(gateTarget('unpaired', route('/connect'))).toBeUndefined()
  })

  it('без профиля уводит на выбор и передаёт next с экрана кода', () => {
    expect(gateTarget('choosing', route('/connect?next=/search'))).toEqual({
      path: '/profiles',
      query: { next: '/search' },
    })
    expect(gateTarget('choosing', route('/title/tmdb:tv:1'))).toEqual({
      path: '/profiles',
      query: { next: '/title/tmdb:tv:1' },
    })
    expect(gateTarget('choosing', route('/profiles'))).toBeUndefined()
  })

  it('готовой витрине открыто всё, кроме экрана кода', () => {
    expect(gateTarget('ready', route('/profiles'))).toBeUndefined()
    expect(gateTarget('ready', route('/series'))).toBeUndefined()
    expect(gateTarget('ready', route('/connect?next=/series'))).toEqual({
      path: '/series',
    })
  })

  it('«О программе» открыта всегда', () => {
    expect(gateTarget('unpaired', route('/about'))).toBeUndefined()
    expect(gateTarget('choosing', route('/about'))).toBeUndefined()
  })
})

describe('safeNext', () => {
  it('пропускает только путь витрины', () => {
    expect(safeNext('/title/1')).toBe('/title/1')
    expect(safeNext('//evil.example')).toBeUndefined()
    expect(safeNext('https://evil.example')).toBeUndefined()
    expect(safeNext(['/a'])).toBeUndefined()
  })
})

describe('autoProfile', () => {
  it('выбирает единственный профиль без PIN', () => {
    const only = profile('a')

    expect(
      autoProfile({ items: [only], currentId: 'a', selected: false }),
    ).toBe(only)
  })

  it('с PIN или несколькими профилями — экран выбора', () => {
    expect(
      autoProfile({
        items: [profile('a', true)],
        currentId: 'a',
        selected: false,
      }),
    ).toBeUndefined()
    expect(
      autoProfile({
        items: [profile('a'), profile('b')],
        currentId: 'a',
        selected: false,
      }),
    ).toBeUndefined()
  })
})
