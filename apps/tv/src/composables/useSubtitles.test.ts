import { effectScope, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../api.ts'
import { useSubtitles } from './useSubtitles.ts'

vi.mock('../api.ts', () => ({
  api: { playback: { getPlaybackSubtitles: vi.fn() } },
}))

const getCues = vi.mocked(api.playback.getPlaybackSubtitles)
const cue = { start: 4, end: 6, text: 'Subtitle' }

beforeEach(() => {
  getCues.mockReset()
  vi.useFakeTimers()
})

afterEach(() => vi.useRealTimers())

function setup(seconds: number) {
  const element = new EventTarget()
  const position = ref(seconds)
  const scope = effectScope()
  const subtitles = scope.run(() =>
    useSubtitles(shallowRef(element as HTMLVideoElement), position),
  )!
  return { element, position, subtitles, stop: () => scope.stop() }
}

it('uses shifted source time for both the cue window and overlap', async () => {
  getCues.mockResolvedValue({ cues: [cue], done: true })
  const { position, subtitles, stop } = setup(6)
  try {
    subtitles.show('session', 'f0', 500)
    await Promise.resolve()
    expect(getCues).toHaveBeenLastCalledWith(
      'session',
      'f0',
      { from: '5' },
      expect.anything(),
    )
    expect(subtitles.html.value).toBe('Subtitle')

    subtitles.setOffset(-500)
    expect(getCues).toHaveBeenLastCalledWith(
      'session',
      'f0',
      { from: '6' },
      expect.anything(),
    )
    expect(subtitles.html.value).toBe('')
    position.value = 3.5
    expect(subtitles.html.value).toBe('Subtitle')

    position.value = 0
    subtitles.setOffset(500)
    expect(getCues).toHaveBeenLastCalledWith(
      'session',
      'f0',
      { from: '0' },
      expect.anything(),
    )
    expect(subtitles.html.value).toBe('')
  }
  finally {
    stop()
  }
})

it('loads immediately after a seek and ignores a late response for the old window', async () => {
  let resolveFirst!: (value: Awaited<ReturnType<typeof getCues>>) => void
  getCues.mockImplementationOnce(
    () => new Promise(resolve => (resolveFirst = resolve)),
  )
  getCues.mockResolvedValueOnce({ cues: [cue], done: true })
  const { element, position, subtitles, stop } = setup(0)
  try {
    subtitles.show('session', 'f0')
    const firstSignal = getCues.mock.calls[0]?.[3]?.signal
    position.value = 5
    element.dispatchEvent(new Event('seeked'))
    expect(firstSignal?.aborted).toBe(true)
    expect(getCues).toHaveBeenCalledTimes(2)
    resolveFirst({ cues: [{ ...cue, text: 'Stale window' }], done: true })
    await Promise.resolve()
    expect(subtitles.html.value).toBe('Subtitle')
  }
  finally {
    stop()
  }
})
