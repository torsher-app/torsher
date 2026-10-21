import { describe, expect, it } from 'vitest'
import {
  matchesHost,
  normalizeHost,
  normalizeMatch,
  pickRoute,
} from './match.ts'

describe('normalizeMatch', () => {
  it('accepts hosts, subdomain masks and the default', () => {
    expect(normalizeMatch(' API.Example.org. ')).toBe('api.example.org')
    expect(normalizeMatch('*.example.org')).toBe('*.example.org')
    expect(normalizeMatch('*')).toBe('*')
    expect(normalizeMatch('10.0.0.5')).toBe('10.0.0.5')
    expect(normalizeMatch('::1')).toBe('[::1]')
    expect(normalizeMatch('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai')
  })

  it('rejects urls, ports, inner wildcards and masks over ip', () => {
    for (const input of [
      '',
      'https://example.org',
      'example.org:8080',
      'example.org/path',
      'api.*.example.org',
      '*example.org',
      '*.10.0.0.5',
      '-bad.example',
    ])
      expect(normalizeMatch(input)).toBeUndefined()
  })
})

describe('matchesHost', () => {
  it('matches a mask against subdomains only', () => {
    expect(matchesHost('*.example.org', 'api.example.org')).toBe(true)
    expect(matchesHost('*.example.org', 'a.b.example.org')).toBe(true)
    expect(matchesHost('*.example.org', 'example.org')).toBe(false)
    expect(matchesHost('*.example.org', 'example.org.evil')).toBe(false)
    expect(matchesHost('*.example.org', 'badexample.org')).toBe(false)
  })

  it('matches by host, not by a substring of the address', () => {
    expect(matchesHost('indexer', 'api.indexer.example')).toBe(false)
    expect(matchesHost('indexer', 'indexer')).toBe(true)
  })
})

describe('pickRoute', () => {
  const routes = [
    { id: 'glob-a', match: '*.example.org' },
    { id: 'glob-b', match: '*.api.example.org' },
    { id: 'exact', match: 'v1.api.example.org' },
    { id: 'default', match: '*' },
  ]

  it('prefers an exact host over masks', () => {
    expect(pickRoute(routes, 'v1.api.example.org')?.id).toBe('exact')
  })

  it('takes the first matching mask in order', () => {
    expect(pickRoute(routes, 'v2.api.example.org')?.id).toBe('glob-a')
  })

  it('falls back to the default route', () => {
    expect(pickRoute(routes, 'example.org.evil')?.id).toBe('default')
    expect(pickRoute(routes, normalizeHost('Example.ORG')!)?.id).toBe(
      'default',
    )
  })
})
