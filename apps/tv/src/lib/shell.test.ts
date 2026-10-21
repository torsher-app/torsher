import { describe, expect, it } from 'vitest'
import { panelSignInUrl, shellIndex, stepsToShell } from './shell.ts'

describe('shellIndex', () => {
  it('читает номер записи обёртки', () => {
    expect(shellIndex('?platform=tv&shell=0')).toBe(0)
    expect(shellIndex('?shell=12&platform=tv')).toBe(12)
  })

  it('без параметра или с мусором — null', () => {
    expect(shellIndex('?platform=tv')).toBeNull()
    expect(shellIndex('?shell=-1')).toBeNull()
    expect(shellIndex('?shell=abc')).toBeNull()
    expect(shellIndex('?shell=')).toBeNull()
  })
})

describe('stepsToShell', () => {
  it('сразу после обёртки — на одну назад', () => {
    expect(stepsToShell(0, 1)).toBe(-1)
  })

  it('после входа через панель — через запись панели', () => {
    expect(stepsToShell(0, 3)).toBe(-3)
  })

  it('обёртка не позади — шага нет', () => {
    expect(stepsToShell(4, 4)).toBeNull()
    expect(stepsToShell(5, 2)).toBeNull()
  })
})

describe('panelSignInUrl', () => {
  function at(href: string) {
    const url = new URL(href)
    return { href, pathname: url.pathname, search: url.search, hash: url.hash }
  }

  it('ведёт в панель того же сервера и возвращает на текущий экран', () => {
    const url = new URL(
      panelSignInUrl(at('http://192.168.1.10:8080/?platform=tv#/movies')),
    )

    expect(url.origin + url.pathname).toBe(
      'http://192.168.1.10:8080/panel/auth/login',
    )
    expect(url.searchParams.get('next')).toBe('/?platform=tv#/movies')
    expect(url.searchParams.get('platform')).toBe('tv')
  })

  it('учитывает подпуть обратного прокси', () => {
    const url = new URL(
      panelSignInUrl(at('https://media.example/torsher/?platform=tv#/')),
    )

    expect(url.pathname).toBe('/torsher/panel/auth/login')
    expect(url.searchParams.get('next')).toBe('/torsher/?platform=tv#/')
  })
})
