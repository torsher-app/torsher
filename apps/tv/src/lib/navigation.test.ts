import { describe, expect, it } from 'vitest'
import { backAction, openedForward, returnedBack } from './navigation.ts'

const ID = 'tmdb:tv:1399'

function route(
  pattern: string,
  params: Record<string, string> = {},
  query: Record<string, string> = {},
) {
  return { pattern, params: { id: ID, ...params }, query }
}

const files = route('/title/:id/files/:torrentId', { torrentId: 't1' })
const sources = route('/title/:id/sources')
const card = route('/title/:id')

describe('backAction', () => {
  it('обычный путь — шаг назад по истории', () => {
    expect(backAction(files, `/title/${ID}/sources`)).toEqual({
      kind: 'history',
    })
    expect(backAction(sources, `/title/${ID}`)).toEqual({ kind: 'history' })
    expect(backAction(card, '/search')).toEqual({ kind: 'history' })
    expect(backAction(card, '/title/tmdb:movie:1')).toEqual({
      kind: 'history',
    })
  })

  it('персона — назад туда, откуда открыли, без истории — на главную', () => {
    const person = route('/person/:id', { id: 'tmdb:person:525' })

    expect(backAction(person, '/title/tmdb:movie:27205')).toEqual({
      kind: 'history',
    })
    expect(backAction(person, null)).toEqual({ kind: 'replace', path: '/' })
  })

  it('без истории — родитель вместо текущей записи', () => {
    expect(backAction(files, undefined)).toEqual({
      kind: 'replace',
      path: `/title/${ID}/sources`,
    })
    expect(backAction(sources, null)).toEqual({
      kind: 'replace',
      path: `/title/${ID}`,
    })
    expect(backAction(card, null)).toEqual({ kind: 'replace', path: '/' })
  })

  it('прошлая запись — дочерний экран: не возвращаемся в него', () => {
    expect(backAction(card, `/title/${ID}/files/t1?season=2`)).toEqual({
      kind: 'replace',
      path: '/',
    })
    expect(backAction(card, `/title/${ID}/sources`)).toEqual({
      kind: 'replace',
      path: '/',
    })
    expect(backAction(card, '/play/t1/3?title=x')).toEqual({
      kind: 'replace',
      path: '/',
    })
    expect(backAction(sources, `/title/${ID}/files/t1`)).toEqual({
      kind: 'replace',
      path: `/title/${ID}`,
    })
  })

  it('плеер с тайтлом — в «Файлы» своей раздачи', () => {
    const player = route(
      '/play/:torrentId/:fileIndex',
      { torrentId: 't1', fileIndex: '3' },
      { title: ID },
    )

    expect(backAction(player, `/title/${ID}/files/t1?season=2`)).toEqual({
      kind: 'history',
    })
    expect(backAction(player, null)).toEqual({
      kind: 'replace',
      path: `/title/${ID}/files/t1`,
    })
  })

  it('плеер единственного файла — прямо в «Источники»', () => {
    const player = route(
      '/play/:torrentId/:fileIndex',
      { torrentId: 't1', fileIndex: '0' },
      { title: ID },
    )

    expect(backAction(player, `/title/${ID}/sources`)).toEqual({
      kind: 'history',
    })
  })

  it('плеер из «Продолжить» — туда, откуда открыли', () => {
    const player = route(
      '/play/:torrentId/:fileIndex',
      { torrentId: 't2', fileIndex: '1' },
      { title: ID },
    )

    expect(backAction(player, '/')).toEqual({ kind: 'history' })
    expect(backAction(player, `/title/${ID}`)).toEqual({ kind: 'history' })
    // Серию сменили в плеере: прошлая запись — «Файлы» другой раздачи
    expect(backAction(player, `/title/${ID}/files/t1`)).toEqual({
      kind: 'replace',
      path: `/title/${ID}/files/t2`,
    })
    expect(backAction(player, '/play/t1/0?title=x')).toEqual({
      kind: 'replace',
      path: `/title/${ID}/files/t2`,
    })
  })

  it('раздел рейла — на главную', () => {
    for (const section of [
      '/movies',
      '/series',
      '/search',
      '/mine',
      '/settings',
      '/about',
    ]) {
      expect(backAction(route(section), '/')).toEqual({ kind: 'history' })
      expect(backAction(route(section), null)).toEqual({
        kind: 'replace',
        path: '/',
      })
      // Не по кругу через прошлые разделы и не в карточку перед разделом
      expect(backAction(route(section), '/movies')).toEqual({
        kind: 'replace',
        path: '/',
      })
      expect(backAction(route(section), `/title/${ID}`)).toEqual({
        kind: 'replace',
        path: '/',
      })
    }
  })

  it('главная — корень при любой истории', () => {
    expect(backAction(route('/'), undefined)).toEqual({ kind: 'none' })
    expect(backAction(route('/'), '/series')).toEqual({ kind: 'none' })
    expect(backAction(route('/'), `/title/${ID}`)).toEqual({ kind: 'none' })
    expect(backAction(route('/'), '/play/t1/3?title=x')).toEqual({
      kind: 'none',
    })
  })

  it('прочие экраны — по истории, а без неё — корень', () => {
    expect(backAction(route('/profiles'), '/')).toEqual({ kind: 'history' })
    expect(backAction(route('/profiles'), null)).toEqual({ kind: 'none' })
  })
})

describe('returnedBack', () => {
  it('вернулись `router.back()` с экрана впереди', () => {
    expect(returnedBack({ forward: `/title/${ID}` })).toBe(true)
  })

  it('открыт шагом вперёд, рейлом на месте раздела или по ссылке', () => {
    expect(returnedBack({ forward: null })).toBe(false)
    expect(returnedBack({})).toBe(false)
  })
})

describe('openedForward', () => {
  it('шаг вперёд с другого экрана', () => {
    expect(openedForward({ back: `/title/${ID}/sources`, forward: null })).toBe(
      true,
    )
  })

  it('возврат `router.back()` с дочернего экрана', () => {
    expect(
      openedForward({
        back: `/title/${ID}/sources`,
        forward: '/play/t1/0?title=tmdb:tv:1399',
      }),
    ).toBe(false)
  })

  it('запись подставил goBack или экран открыт по ссылке', () => {
    expect(openedForward({ back: null, forward: null })).toBe(false)
    expect(openedForward({})).toBe(false)
  })
})
