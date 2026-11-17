import { statfs } from 'node:fs/promises'
import { beforeEach, expect, it, vi } from 'vitest'
import { diskUsage } from './disk.ts'

vi.mock('node:fs/promises', () => ({ statfs: vi.fn() }))

const snapshot = {
  type: 0x65735546,
  bsize: 1048576,
  frsize: 4096,
  blocks: 120699413,
  bfree: 3000000,
  bavail: 2933232,
  files: 125512416,
  ffree: 117329280,
}

beforeEach(() => {
  vi.mocked(statfs).mockReset()
})

it('reports grpcfuse capacity and unprivileged free bytes in fundamental blocks', async () => {
  vi.mocked(statfs).mockResolvedValue(snapshot)
  expect(await diskUsage('/data')).toEqual({
    total: 494384795648,
    free: 12014518272,
  })
})

it.each([undefined, 0])(
  'uses transfer blocks when frsize is %s',
  async (frsize) => {
    vi.mocked(statfs).mockResolvedValue({
      ...snapshot,
      frsize,
    } as typeof snapshot)
    expect(await diskUsage('/data')).toEqual({
      total: snapshot.blocks * snapshot.bsize,
      free: snapshot.bavail * snapshot.bsize,
    })
  },
)

it('preserves zero available space and equal block sizes', async () => {
  vi.mocked(statfs).mockResolvedValue({ ...snapshot, bsize: 4096, bavail: 0 })
  expect(await diskUsage('/data')).toEqual({ total: 494384795648, free: 0 })
})

it('uses the nearest existing parent only for missing paths', async () => {
  vi.mocked(statfs)
    .mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    )
    .mockResolvedValueOnce(snapshot)
  expect(await diskUsage('/data/new')).toEqual({
    total: 494384795648,
    free: 12014518272,
  })
  expect(vi.mocked(statfs).mock.calls.map(([path]) => path)).toEqual([
    '/data/new',
    '/data',
  ])
})

it.each(['EACCES', 'ESTALE', 'EIO'])(
  'propagates %s instead of inventing capacity',
  async (code) => {
    const error = Object.assign(new Error(code), { code })
    vi.mocked(statfs).mockRejectedValue(error)
    await expect(diskUsage('/data')).rejects.toMatchObject({ code })
    expect(statfs).toHaveBeenCalledOnce()
  },
)

it('stops at the filesystem root when even it is unavailable', async () => {
  const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
  vi.mocked(statfs).mockRejectedValue(error)
  await expect(diskUsage('/')).rejects.toMatchObject({ code: 'ENOENT' })
  expect(statfs).toHaveBeenCalledOnce()
})
