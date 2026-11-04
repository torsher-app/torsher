import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

type Read = (path: string) => Promise<string | null>
interface Group {
  dir: string
  mount: string
  v2: boolean
}
export const read: Read = path =>
  readFile(path, 'utf8').then(
    s => s.trim(),
    () => null,
  )
export const emptyCounters = {
  cpuUsec: null,
  cpuCapacity: null,
  memoryBytes: null,
  memoryLimit: null,
  memoryCacheBytes: null,
}

function integer(text?: string | null) {
  if (text == null || !/^\d+$/.test(text))
    return null
  const n = Number(text)
  return Number.isSafeInteger(n) ? n : null
}

// proc paths are relative to the namespace; the mount may expose just its subtree.
function locate(
  groups: string,
  mounts: string,
  controller: string,
): Group | undefined {
  // On a hybrid host prefer the hierarchy that explicitly owns this controller.
  const lines = groups.split('\n')
  const explicit = lines.filter(line =>
    line.split(':')[1]?.split(',').includes(controller),
  )
  for (const line of explicit.length ? explicit : lines) {
    const match = /^\d+:([^:]*):(\/.*)$/.exec(line)
    if (!match || match[2].split('/').includes('..'))
      continue
    const v2 = !match[1]
    if (!v2 && !match[1].split(',').includes(controller))
      continue
    for (const mount of mounts.split('\n')) {
      const [left, right] = mount.split(' - ')
      const [type, , flags] = (right ?? '').split(' ')
      if (
        v2
          ? type !== 'cgroup2'
          : type !== 'cgroup' || !flags?.split(',').includes(controller)
      ) {
        continue
      }
      const [, , , root, point] = left.split(' ')
      if (!point || !root)
        continue
      const path = match[2]
      const suffix = path === '/' ? '' : relative(root, path)
      if (suffix.startsWith('..'))
        continue
      return { dir: join(point, suffix), mount: point, v2 }
    }
  }
}

async function limits(
  group: Group,
  get: (dir: string) => Promise<number | null>,
) {
  let result: number | null = null
  for (let dir = group.dir; ; dir = dirname(dir)) {
    const n = await get(dir)
    // The hierarchy root may omit limit files altogether.
    if (n === null && (dir !== group.mount || dir === group.dir))
      return null
    if (n !== null && n > 0)
      result = Math.min(result ?? n, n)
    if (dir === group.mount)
      return result
  }
}

async function quota(dir: string, v2: boolean, get: Read) {
  const [max, period] = v2
    ? ((await get(join(dir, 'cpu.max'))) ?? '').split(/\s+/)
    : await Promise.all(
        ['cpu.cfs_quota_us', 'cpu.cfs_period_us'].map(f => get(join(dir, f))),
      )
  const n = integer(max)
  const p = integer(period)
  if (p && (max === 'max' || max === '-1'))
    return Infinity
  return n && p ? n / p : null
}

function affinity(status: string | null) {
  const list = /^Cpus_allowed_list:\s*([\d,-]+)$/m.exec(status ?? '')?.[1]
  if (!list)
    return null
  let size = 0
  for (const range of list.split(',')) {
    const [first, last = first] = range.split('-').map(Number)
    if (!Number.isInteger(first) || !Number.isInteger(last) || last < first)
      return null
    size += last - first + 1
  }
  return size || null
}

export async function readCounters(get: Read = read) {
  const [groups, mounts] = await Promise.all(
    ['/proc/self/cgroup', '/proc/self/mountinfo'].map(get),
  )
  if (!groups || !mounts)
    return emptyCounters
  const cpu = locate(groups, mounts, 'cpuacct')
  const cap = locate(groups, mounts, 'cpu')
  const mem = locate(groups, mounts, 'memory')
  async function cpuTime() {
    if (!cpu)
      return null
    if (!cpu.v2) {
      const ns = await get(join(cpu.dir, 'cpuacct.usage'))
      // v1 reports cumulative nanoseconds: scale before subtracting two samples.
      return ns && /^\d+$/.test(ns) ? Number(BigInt(ns) / 1000n) : null
    }
    return integer(
      /^usage_usec (\d+)$/m.exec(
        (await get(join(cpu.dir, 'cpu.stat'))) ?? '',
      )?.[1],
    )
  }
  const [
    cpuUsec,
    cpuQuota,
    allowed,
    memoryBytes,
    memoryCacheBytes,
    memoryLimit,
  ] = await Promise.all([
    cpuTime(),
    cap && limits(cap, dir => quota(dir, cap.v2, get)),
    get('/proc/self/status').then(affinity),
    mem
    && get(
      join(mem.dir, mem.v2 ? 'memory.current' : 'memory.usage_in_bytes'),
    ).then(integer),
    mem
    && get(join(mem.dir, 'memory.stat')).then((stat) => {
      const field = mem.v2
        ? /^inactive_file (\d+)$/m
        : /^total_inactive_file (\d+)$/m
      return integer(field.exec(stat ?? '')?.[1])
    }),
    mem
    && limits(mem, async (dir) => {
      const value = await get(
        join(dir, mem.v2 ? 'memory.max' : 'memory.limit_in_bytes'),
      )
      // v1 uses a page-aligned LONG_MAX sentinel for an unlimited group.
      if (
        value === 'max'
        || (!mem.v2
          && value
          && /^\d+$/.test(value)
          && BigInt(value) >= 0x7FFFFFFFFFFFF000n)
      ) {
        return Infinity
      }
      return integer(value)
    }),
  ])
  const capacity
    = cpuQuota != null && allowed !== null ? Math.min(cpuQuota, allowed) : null
  return {
    cpuUsec,
    cpuCapacity: capacity,
    memoryBytes: memoryBytes ?? null,
    // Counters are sampled separately. Discard an inconsistent breakdown.
    memoryCacheBytes:
      memoryCacheBytes != null
      && memoryBytes != null
      && memoryCacheBytes <= memoryBytes
        ? memoryCacheBytes
        : null,
    memoryLimit:
      memoryLimit != null && Number.isFinite(memoryLimit) ? memoryLimit : null,
  }
}
