import type { PlayerSnapshot } from '../lib/nativeVideo.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { playerBufferedSeconds } from '../lib/player.ts'

class VideoElement extends EventTarget {
  removeAttribute(_name: string) {}
}

afterEach(() => vi.unstubAllGlobals())

it('carries load, seek, audio and stop through the Android bridge and applies state before events', async () => {
  vi.resetModules()
  const commands: { type: string, [key: string]: unknown }[] = []
  const bridge = {
    postMessage: (value: string) => commands.push(JSON.parse(value)),
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
  }
  const classes = new Set<string>()
  vi.stubGlobal('HTMLElement', VideoElement)
  vi.stubGlobal('location', { href: 'http://stand.example/tv/' })
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
    },
  })
  vi.stubGlobal('window', {
    TorsherShell: {
      platform: 'android',
      bridge: 'torsherBridge',
      nativePlayer: true,
    },
    torsherBridge: bridge,
  })
  const { connectAndroidShell } = await import('./android.ts')
  const { attachNativeVideo } = await import('./nativeVideo.ts')
  connectAndroidShell()
  const el = new VideoElement() as unknown as HTMLVideoElement
  const detach = attachNativeVideo(el)
  const seen: {
    event: string
    time: number
    paused: boolean
    ended: boolean
  }[] = []
  for (const event of ['loadedmetadata', 'seeking', 'pause', 'ended']) {
    el.addEventListener(event, () =>
      seen.push({
        event,
        time: el.currentTime,
        paused: el.paused,
        ended: el.ended,
      }))
  }
  const snapshot: PlayerSnapshot = {
    time: 42,
    duration: 120,
    buffered: 90,
    paused: true,
    ended: false,
    rate: 1,
    readyState: 4,
    error: null,
    audio: [
      { label: 'First', language: 'en', enabled: true },
      { label: 'Second', language: 'de', enabled: false },
    ],
    events: ['loadedmetadata', 'seeking'],
  }
  const publish = (patch: Partial<PlayerSnapshot> = {}) =>
    bridge.onmessage?.({
      data: JSON.stringify({ type: 'player.state', ...snapshot, ...patch }),
    } as MessageEvent<string>)
  el.src = '/api/stream/first'
  el.currentTime = 42
  publish()
  expect(seen).toEqual([
    { event: 'loadedmetadata', time: 42, paused: true, ended: false },
    { event: 'seeking', time: 42, paused: true, ended: false },
  ])
  const tracks = (el as unknown as { audioTracks: { enabled: boolean }[] })
    .audioTracks
  tracks[1]!.enabled = true
  await el.play()
  expect(el.paused).toBe(false)
  // The adapter advances its range start between native snapshots. The OSD
  // must sample its live clock after capturing that range, not use timeupdate's
  // older position (42), which no longer lies inside the moving range.
  let clock = 1000
  vi.stubGlobal('performance', { now: () => clock++ })
  publish({
    time: 42,
    buffered: 72,
    paused: false,
    readyState: 4,
    rate: 1,
    events: ['playing'],
  })
  clock += 100
  const ahead = playerBufferedSeconds(el)
  expect(ahead).toBeGreaterThan(29)
  expect(ahead).toBeLessThan(30)
  el.currentTime = 10
  expect(playerBufferedSeconds(el)).toBe(0)
  publish({ time: 10, buffered: 25, paused: false, events: ['seeking'] })
  expect(playerBufferedSeconds(el)).toBeGreaterThan(14)
  expect(playerBufferedSeconds(el)).toBeLessThan(15)
  publish({ time: 120, paused: true, ended: true, events: ['pause', 'ended'] })
  expect(seen.slice(-2)).toEqual([
    { event: 'pause', time: 120, paused: true, ended: true },
    { event: 'ended', time: 120, paused: true, ended: true },
  ])
  el.removeAttribute('src')
  el.load()
  expect(commands).toEqual([
    { type: 'ready' },
    { type: 'player.load', url: 'http://stand.example/api/stream/first' },
    { type: 'player.seek', time: 42 },
    { type: 'player.audio', index: 1 },
    { type: 'player.play' },
    { type: 'player.seek', time: 10 },
    { type: 'player.stop' },
  ])
  expect(classes.has('native-video')).toBe(true)
  detach()
  const count = seen.length
  publish({ events: ['ended'] })
  expect(seen).toHaveLength(count)
  expect(classes.has('native-video')).toBe(false)
  expect(Object.hasOwn(el, 'currentTime')).toBe(false)
  expect(commands.at(-1)).toEqual({ type: 'player.stop' })
})
