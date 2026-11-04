import { describe, expect, it } from 'vitest'
import { intervalRate } from './monitor.ts'
import { readCounters } from './resources.ts'

const mount = '/sys/fs/cgroup'
const v2 = {
  '/proc/self/cgroup': '0::/docker/torsher',
  '/proc/self/mountinfo': `10 1 0:3 /docker ${mount} ro - cgroup2 cgroup rw`,
  '/proc/self/status': 'Name: node\nCpus_allowed_list:\t0-1,4-5',
  [`${mount}/torsher/cpu.max`]: 'max 100000',
  [`${mount}/torsher/memory.current`]: '123456',
  [`${mount}/torsher/memory.max`]: 'max',
}

async function from(
  files: Record<string, string>,
  counter: string,
  values: string[],
) {
  const get = async (path: string) =>
    path === counter ? (values.shift() ?? null) : (files[path] ?? null)
  const before = await readCounters(get)
  const { cpuUsec, ...stats } = await readCounters(get)
  const rate = intervalRate(before.cpuUsec, cpuUsec, 500)
  return { ...stats, cpuCores: rate === null ? null : rate / 1e6 }
}

describe('container resources', () => {
  it('reports one core of four from group time, including child processes; memory includes cache', async () => {
    expect(
      await from(v2, `${mount}/torsher/cpu.stat`, [
        'usage_usec 250000',
        'usage_usec 750000',
      ]),
    ).toEqual({
      cpuCores: 1,
      cpuCapacity: 4,
      memoryBytes: 123456,
      memoryLimit: null,
    })
  })
  it('honors fractional CPU quotas and memory ceilings inherited from a visible ancestor', async () => {
    const got = await from(
      {
        ...v2,
        [`${mount}/cpu.max`]: '150000 100000',
        [`${mount}/memory.max`]: '200000',
      },
      `${mount}/torsher/cpu.stat`,
      ['usage_usec 100', 'usage_usec 100'],
    )
    expect(got).toEqual({
      cpuCores: 0,
      cpuCapacity: 1.5,
      memoryBytes: 123456,
      memoryLimit: 200000,
    })
  })
  it('resolves separate v1 controllers, even with a hybrid v2 mount and large nanosecond counters', async () => {
    const v1 = {
      ...v2,
      '/proc/self/cgroup': '0::/\n3:cpu,cpuacct:/docker/t\n4:memory:/docker/t',
      '/proc/self/mountinfo': `${v2['/proc/self/mountinfo']}\n11 1 0:4 /docker/t /cg/cpu ro - cgroup cgroup rw,cpu,cpuacct\n12 1 0:5 /docker/t /cg/mem ro - cgroup cgroup rw,memory`,
      '/cg/cpu/cpu.cfs_quota_us': '50000',
      '/cg/cpu/cpu.cfs_period_us': '100000',
      '/cg/mem/memory.usage_in_bytes': '5000',
      '/cg/mem/memory.limit_in_bytes': '9223372036854771712',
    }
    expect(
      await from(v1, '/cg/cpu/cpuacct.usage', [
        '140000000000000000',
        '140000000250000000',
      ]),
    ).toEqual({
      cpuCores: 0.5,
      cpuCapacity: 0.5,
      memoryBytes: 5000,
      memoryLimit: null,
    })
  })
  it('keeps memory if CPU is unavailable or reset, never substituting zero', async () => {
    for (const values of [[], ['usage_usec 500', 'usage_usec 400'], ['bad']]) {
      expect(await from(v2, `${mount}/torsher/cpu.stat`, values)).toMatchObject(
        { cpuCores: null, memoryBytes: 123456 },
      )
    }
    expect(await from({}, '', [])).toEqual({
      cpuCores: null,
      cpuCapacity: null,
      memoryBytes: null,
      memoryLimit: null,
    })
  })
})
