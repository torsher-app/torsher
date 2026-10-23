import type { Torrent } from '../../db/schema.ts'
import { describe, expect, it } from 'vitest'
import { torrentResolution } from './resolution.ts'

function torrent(extra: Partial<Torrent>): Torrent {
  return {
    name: 'Раздача',
    files: [],
    videoWidth: null,
    videoHeight: null,
    ...extra,
  } as Torrent
}

describe('torrentResolution', () => {
  it('кадр из пробы сильнее имён файлов', () => {
    expect(
      torrentResolution(
        torrent({
          videoWidth: 1920,
          videoHeight: 800,
          files: [{ path: 'Film.720p.mkv', size: 10, padding: false }],
        }),
      ),
    ).toEqual({ value: '1080p', basis: 'probe', sure: true })
  })

  it('без пробы — имя самого большого видеофайла, затем папки и раздачи', () => {
    expect(
      torrentResolution(
        torrent({
          files: [
            {
              path: 'Show.S01.BDRip.1080p/sample.2160p.mkv',
              size: 5,
              padding: false,
            },
            {
              path: 'Show.S01.BDRip.1080p/Show.S01E01.mkv',
              size: 500,
              padding: false,
            },
          ],
        }),
      ),
    ).toEqual({ value: '1080p', basis: 'file', sure: true })
    expect(
      torrentResolution(torrent({ name: 'Show S01-05 (h.265) (720P)' })),
    ).toEqual({ value: '720p', basis: 'file', sure: true })
  })

  it('в файлах разрешения нет — не узнать', () => {
    expect(
      torrentResolution(
        torrent({
          name: 'Show (KvK)',
          files: [
            {
              path: 'Season 01/Show.s01e01.XviD.BDrip.avi',
              size: 900,
              padding: false,
            },
          ],
        }),
      ),
    ).toBeUndefined()
  })
})
