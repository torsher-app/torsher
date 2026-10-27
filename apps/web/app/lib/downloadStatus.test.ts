import type { Torrent } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { downloadViewOf } from './downloadStatus'

function cached(stopped: Torrent['seeding']['stopped']) {
  return {
    status: 'ready',
    state: 'partial',
    streaming: false,
    pauseReason: null,
    progress: { downloaded: 0, wanted: 0 },
    seeding: { rule: null, effective: null, uploaded: 0, ratio: null, stopped },
  } satisfies Parameters<typeof downloadViewOf>[0]
}

describe('downloadViewOf', () => {
  it('просмотренное, которое раздаётся, — в группе «Раздаются»', () => {
    expect(downloadViewOf(cached(null))).toMatchObject({
      status: 'partial',
      group: 'seeding',
    })
  })

  it('просмотренное без раздачи — в «Не скачиваются»', () => {
    expect(downloadViewOf(cached('cache'))).toMatchObject({
      status: 'partial',
      group: 'idle',
    })
  })
})
