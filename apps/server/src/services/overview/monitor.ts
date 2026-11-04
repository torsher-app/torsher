import type { HistoryRange, LoadPoint } from '../../dto/overview.ts'
import { readlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { config } from '../../config.ts'
import { logFor, throttleLog } from '../logs/index.ts'
import { aggregatePoints, LoadArchive, MINUTE, ranges } from './history.ts'
import { read, readCounters } from './resources.ts'

const INTERVAL = 5000
const WINDOW = 15 * 60_000
type Counters = Awaited<ReturnType<typeof readCounters>>
type Traffic = Map<string, [number, number]>

export function intervalRate(
  first: number | null,
  last: number | null,
  ms: number,
) {
  return first !== null
    && last !== null
    && last >= first
    && ms > 0
    && ms <= INTERVAL * 2
    ? ((last - first) * 1000) / ms
    : null
}

// /proc/self/net/dev reports bytes per interface in this network namespace.
// Exclude loopback (server ↔ engine), and never count the initial host namespace.
export function networkCounters(
  dev: string | null,
  namespace: string | null,
): Traffic | null {
  if (
    !dev
    || !namespace
    || !/^net:\[\d+\]$/.test(namespace)
    || namespace === 'net:[4026531833]'
    || namespace === 'net:[4026531840]'
  ) {
    return null
  }
  const result: Traffic = new Map()
  for (const line of dev.split('\n')) {
    const colon = line.lastIndexOf(':')
    if (colon < 0)
      continue
    const iface = line.slice(0, colon).trim()
    if (iface === 'lo')
      continue
    const fields = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
    const rx = Number(fields[0])
    const tx = Number(fields[8])
    if (
      !Number.isSafeInteger(rx)
      || !Number.isSafeInteger(tx)
      || rx < 0
      || tx < 0
    ) {
      return null
    }
    result.set(iface, [rx, tx])
  }
  return result.size ? result : null
}

export function trafficRates(
  before: Traffic | null,
  after: Traffic | null,
  elapsed: number,
) {
  const unknown = { receiveBps: null, sendBps: null }
  if (!before || !after || before.size !== after.size)
    return unknown
  let receiveBps = 0
  let sendBps = 0
  for (const [name, counters] of after) {
    const previous = before.get(name)
    if (!previous)
      return unknown
    const rx = intervalRate(previous[0], counters[0], elapsed)
    const tx = intervalRate(previous[1], counters[1], elapsed)
    if (rx === null || tx === null)
      return unknown
    receiveBps += rx
    sendBps += tx
  }
  return { receiveBps, sendBps }
}

const history: LoadPoint[] = []
let archive: LoadArchive | undefined
let pending: LoadPoint[] = []
let nextOpen = 0
let running = false
let latest: LoadPoint | undefined

function archiveError(err: unknown) {
  if (throttleLog('load-history', 60_000))
    logFor('storage').warn({ err }, 'Container load archive unavailable')
}

function openArchive(now: number) {
  if (archive || now < nextOpen)
    return
  nextOpen = now + MINUTE
  try {
    const path
      = config.databasePath === ':memory:'
        ? ':memory:'
        : join(dirname(config.databasePath), 'load-history.sqlite')
    archive = new LoadArchive(path)
    const points = new Map<number, LoadPoint>()
    for (const point of [...archive.recent(now), ...history])
      points.set(point.time, point)
    history.splice(
      0,
      history.length,
      ...[...points.values()].sort((a, b) => a.time - b.time),
    )
  }
  catch (error) {
    archive?.close()
    archive = undefined
    archiveError(error)
  }
}

function flush(now: number) {
  if (!pending.length || !archive)
    return
  try {
    archive.write(pending, now)
    pending = []
  }
  catch (error) {
    archiveError(error)
    archive.close()
    archive = undefined
    nextOpen = now + MINUTE
  }
}

let previous:
  { counters: Counters, traffic: Traffic | null, clock: number } | undefined
let timer: ReturnType<typeof setTimeout> | undefined
async function tick() {
  try {
    const [counters, dev, ns] = await Promise.all([
      readCounters(),
      read('/proc/self/net/dev'),
      readlink('/proc/self/ns/net').catch(() => null),
    ])
    if (!running)
      return
    const clock = performance.now()
    const time = Date.now()
    const elapsed = clock - (previous?.clock ?? clock)
    const traffic = networkCounters(dev, ns)
    const cpu = intervalRate(
      previous?.counters.cpuUsec ?? null,
      counters.cpuUsec,
      elapsed,
    )
    openArchive(time)
    if (history.length && history[history.length - 1].time >= time) {
      history.length = 0
      pending = []
    }
    if (
      pending.length
      && Math.floor(pending[0].time / MINUTE) !== Math.floor(time / MINUTE)
    ) {
      flush(time)
    }
    latest = {
      time,
      cpuCores: cpu === null ? null : cpu / 1e6,
      memoryBytes: counters.memoryBytes,
      ...trafficRates(previous?.traffic ?? null, traffic, elapsed),
    }
    pending.push(latest)
    if (pending.length > WINDOW / INTERVAL)
      pending.shift()
    history.push(latest)
    while (
      history.length > WINDOW / INTERVAL + 1
      || history[0].time < time - WINDOW
    ) {
      history.shift()
    }
    previous = { counters, traffic, clock }
  }
  finally {
    if (running) {
      timer = setTimeout(tick, INTERVAL)
      timer.unref()
    }
  }
}

export function startResourceMonitor() {
  if (
    !running
    && process.platform === 'linux'
    && process.env.TORSHER_CONTAINER === '1'
  ) {
    running = true
    timer = setTimeout(tick, 0)
    timer.unref()
  }
}

export async function stopResourceMonitor() {
  running = false
  clearTimeout(timer)
  flush(Date.now())
  archive?.close()
  archive = undefined
}

function chartHistory(range: HistoryRange, now: number) {
  if (ranges[range].step === INTERVAL) {
    return history.filter(
      p => p.time >= now - ranges[range].duration && p.time <= now,
    )
  }
  try {
    if (archive)
      return archive.history(range, now, pending)
  }
  catch (error) {
    archiveError(error)
  }
  return aggregatePoints(history, range, now)
}

export function containerResources(range: HistoryRange = '15m') {
  const now = Date.now()
  const last = latest
  return {
    cpuCores: last?.cpuCores ?? null,
    cpuCapacity: previous?.counters.cpuCapacity ?? null,
    memoryBytes: last?.memoryBytes ?? null,
    memoryLimit: previous?.counters.memoryLimit ?? null,
    receiveBps: last?.receiveBps ?? null,
    sendBps: last?.sendBps ?? null,
    history: chartHistory(range, now),
    historyRange: range,
    historyStepMs: ranges[range].step,
    historyEnd: now,
  }
}
