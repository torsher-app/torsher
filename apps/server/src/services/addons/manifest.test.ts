import { describe, expect, it } from 'vitest'
import {
  addonResourceUrl,
  addonText,
  manifestUrl,
  parseAddonManifest,
  supportsAddonResource,
} from './manifest.ts'

const configured = manifestUrl(
  'https://addon.example/api/opaque%2Fsetting/manifest.json?mode=a+b&secret=secret-query',
)

const manifest = {
  id: 'example.addon',
  name: 'Example Add-on',
  version: '1.0.0',
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  resources: [
    'stream',
    { name: 'subtitles', types: ['series'], idPrefixes: [] },
    { name: 'meta', types: ['series'] },
    { name: 'subtitles' },
  ],
  catalogs: [
    { type: 'movie', id: 'first list', name: 'First' },
    {
      type: 'series',
      id: 'skip-list',
      extra: [{ name: 'skip', isRequired: true }],
    },
    {
      type: 'movie',
      id: 'First has search',
      extra: [{ name: 'search', isRequired: true }],
    },
    { type: 'movie', id: 'first list' },
  ],
}

describe('hTTP add-on manifest', () => {
  it('matches each resource independently and accepts only compatible first pages', () => {
    const parsed = parseAddonManifest(manifest, configured)
    expect(supportsAddonResource(parsed, 'stream', 'movie', 'tt123')).toBe(
      true,
    )
    expect(supportsAddonResource(parsed, 'stream', 'movie', 'different')).toBe(
      false,
    )
    expect(
      supportsAddonResource(parsed, 'subtitles', 'series', 'different'),
    ).toBe(true)
    expect(supportsAddonResource(parsed, 'subtitles', 'movie', 'tt123')).toBe(
      false,
    )
    expect(
      supportsAddonResource(parsed, 'catalog', 'movie', 'first list'),
    ).toBe(true)
    expect(
      parsed.catalogs.map(({ id, requiresSkip }) => [id, requiresSkip]),
    ).toEqual([
      ['first list', false],
      ['skip-list', true],
    ])
  })

  it('keeps the exact configured prefix and query while encoding each resource segment', () => {
    expect(
      addonResourceUrl(configured, 'subtitles', 'series', 'tt12:0:1', {
        videoHash: 'one/two=three',
        videoSize: 10,
      }).href,
    ).toBe(
      'https://addon.example/api/opaque%2Fsetting/subtitles/series/tt12%3A0%3A1/videoHash=one%2Ftwo%3Dthree&videoSize=10.json?mode=a+b&secret=secret-query',
    )
    expect(
      addonResourceUrl(configured, 'catalog', 'movie', 'first list').pathname,
    ).toBe('/api/opaque%2Fsetting/catalog/movie/first%20list.json')
    expect(() =>
      addonResourceUrl(configured, 'catalog', 'movie', '..'),
    ).toThrow('bad_response')
    expect(() =>
      manifestUrl('https://addon.example/manifest.json#hidden'),
    ).toThrow('invalid_url')
  })

  it('discards projected metadata that echoes URL secrets or unsafe text', () => {
    expect(addonText('Release opaque%252Fsetting', [configured])).toBe('')
    expect(addonText('Release secret-query', [configured])).toBe('')
    expect(
      addonText('Release secure token-value', [configured], ['token-value']),
    ).toBe('')
    expect(addonText('https%3a%2f%2fexample.com/raw', [configured])).toBe('')
    expect(addonText('Example Альфа', [configured])).toBe('Example Альфа')
    const parsed = parseAddonManifest(
      {
        ...manifest,
        name: 'Projected secret-query',
        catalogs: [{ type: 'movie', id: 'opaque/setting' }],
      },
      configured,
    )
    expect(parsed.name).toBe('')
    expect(parsed.catalogs).toEqual([])
    expect(() =>
      parseAddonManifest(
        {
          ...manifest,
          behaviorHints: { configurationRequired: true },
        },
        configured,
      ),
    ).toThrow('unsupported_manifest')
  })
})
