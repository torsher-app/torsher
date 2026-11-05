import { beforeEach, expect, it, vi } from 'vitest'
import { clearProbeCache, peekMediaProbe, probeMedia } from './probe.ts'

const execution = vi.hoisted(() => ({
  callbacks: [] as ((error: Error | null, stdout: string) => void)[],
}))
vi.mock('node:child_process', () => ({
  execFile: (
    _path: string,
    _args: string[],
    _options: unknown,
    done: (error: Error | null, stdout: string) => void,
  ) => {
    execution.callbacks.push(done)
  },
}))
const output = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 800 },
  ],
  format: { format_name: 'matroska', duration: '100' },
})
beforeEach(() => {
  clearProbeCache()
  execution.callbacks = []
})
it('only exposes a completed exact-file probe without executing or awaiting another', async () => {
  expect(peekMediaProbe('hash:0')).toBeUndefined()
  expect(execution.callbacks).toHaveLength(0)
  const pending = probeMedia('hash:0', '/fixture.mkv', 'fixture.mkv')
  expect(peekMediaProbe('hash:0')).toBeUndefined()
  expect(probeMedia('hash:0', '/fixture.mkv', 'fixture.mkv')).toBe(pending)
  expect(execution.callbacks).toHaveLength(1)
  execution.callbacks[0]!(null, output)
  await pending
  expect(peekMediaProbe('hash:0')?.video).toMatchObject({
    width: 1920,
    height: 800,
  })
  expect(peekMediaProbe('hash:1')).toBeUndefined()
  clearProbeCache()
  expect(peekMediaProbe('hash:0')).toBeUndefined()
})
it('evicts the ready result with its promise and does not resurrect an evicted pending entry', async () => {
  const first = probeMedia('hash:0', '/fixture.mkv', 'fixture.mkv')
  const pending = []
  for (let index = 1; index <= 200; index++)
    pending.push(probeMedia(`hash:${index}`, '/fixture.mkv', 'fixture.mkv'))
  execution.callbacks[0]!(null, output)
  await first
  expect(peekMediaProbe('hash:0')).toBeUndefined()
  execution.callbacks.slice(1).forEach(done => done(null, output))
  await Promise.all(pending)
  expect(peekMediaProbe('hash:200')?.video?.width).toBe(1920)
})
