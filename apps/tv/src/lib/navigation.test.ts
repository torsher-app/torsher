import { describe, expect, it } from 'vitest'
import { backAction } from './navigation.ts'

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

  it('экраны вне флоу — по истории, а без неё — корень', () => {
    expect(backAction(route('/search'), '/')).toEqual({ kind: 'history' })
    expect(backAction(route('/'), undefined)).toEqual({ kind: 'none' })
  })
})
