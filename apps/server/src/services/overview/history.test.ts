import type { LoadPoint } from '../../dto/overview.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LoadArchive, MINUTE, ranges } from './history.ts'

const t = Date.UTC(2026, 10, 4)
function sample(
  time: number,
  cpuCores: number | null,
  receiveBps: number | null = null,
): LoadPoint {
  return { time, cpuCores, memoryBytes: 64, receiveBps, sendBps: null }
}

it('preserves raw samples and weighted averages/peaks across restart in the same minute', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'torsher-history-'))
  const path = join(dir, 'history.sqlite')
  let archive = new LoadArchive(path)
  try {
    const a = sample(t, 0, 0)
    const spike = sample(t + 5000, 4)
    archive.write([a, spike], t + 6000)
    archive.close()
    archive = new LoadArchive(path)
    expect(archive.recent(t + 7000)).toEqual([a, spike])
    const b = sample(t + 10_000, 0, 300)
    archive.write([spike, b], t + 11_000)
    const now = t + 2 * MINUTE
    const pending = [sample(t + MINUTE, null, 600)]
    expect(archive.history('24h', now, pending)).toEqual([
      {
        time: t,
        cpuCores: 4 / 3,
        cpuPeak: 4,
        memoryBytes: 64,
        receiveBps: 300,
        sendBps: null,
      },
    ])
    archive.write(pending, now)
    expect(archive.history('24h', now, [])[0].cpuCores).toBe(4 / 3)
    expect(archive.history('1h', now, []).at(-1)).toMatchObject({
      cpuCores: null,
      cpuPeak: null,
    })
  }
  finally {
    archive.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('combines stored minutes in the same bucket by measurement count and keeps the peak', () => {
  const archive = new LoadArchive(':memory:')
  try {
    archive.write([sample(t, 4), sample(t + 5000, 0)], t + 5000)
    archive.write([sample(t + MINUTE, 0)], t + MINUTE)
    const rows = archive.history('24h', t + 3 * MINUTE, [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ time: t, cpuCores: 4 / 3, cpuPeak: 4 })
  }
  finally {
    archive.close()
  }
})

it('retains minute totals for 14 days, expires raw samples and leaves offline intervals empty', () => {
  const archive = new LoadArchive(':memory:')
  const day = 1440 * MINUTE
  try {
    for (const time of [
      t - 15 * day,
      t - 13 * day,
      t - 6 * day,
      t - 100 * MINUTE,
      t - 2 * MINUTE,
      t,
    ]) {
      archive.write([sample(time, 1)], time)
    }
    expect(archive.recent(t).map(p => p.time)).toEqual([t - 2 * MINUTE, t])
    expect(archive.history('14d', t, [])).toHaveLength(5)
    expect(archive.history('7d', t, [])).toHaveLength(4)
    expect(archive.history('24h', t, [])).toHaveLength(3)
    expect(archive.history('1h', t, [])).toHaveLength(2)
    expect(archive.history('14d', t, [])[0].time).toBe(t - 13 * day)
    expect(ranges['14d'].duration / ranges['14d'].step).toBe(336)
  }
  finally {
    archive.close()
  }
})
