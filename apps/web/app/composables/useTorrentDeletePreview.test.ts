import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const mock = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('~/services/api', () => ({
  api: { torrents: { getTorrentDeletePreview: mock.load } },
}))
vi.mock('./useTorrents', () => ({ torrentErrorKind: async () => 'unknown' }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function setup() {
  vi.stubGlobal('withErrorMode', (_mode: string, action: () => unknown) =>
    action())
  const { useTorrentDeletePreview } = await import('./useTorrentDeletePreview')
  const id = ref('one')
  const open = ref(false)
  const scope = effectScope()
  const state = scope.run(() =>
    useTorrentDeletePreview(
      () => id.value,
      () => open.value,
    ),
  )!
  return { id, open, scope, ...state }
}

describe('delete preview lifecycle', () => {
  it('preserves a measured zero and loads again on reopening', async () => {
    mock.load.mockResolvedValue({ reclaimableBytes: 0 })
    const s = await setup()
    expect(mock.load).not.toHaveBeenCalled()
    s.open.value = true
    await nextTick()
    await nextTick()
    expect(s.preview.value).toEqual({ reclaimableBytes: 0 })
    s.open.value = false
    await nextTick()
    expect(s.preview.value).toBeNull()
    s.open.value = true
    await nextTick()
    await nextTick()
    expect(mock.load).toHaveBeenCalledTimes(2)
    s.scope.stop()
  })
  it('ignores stale responses after switching, closing or unmounting', async () => {
    const old = deferred<{ reclaimableBytes: number }>()
    mock.load
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ reclaimableBytes: 8192 })
    const s = await setup()
    s.open.value = true
    await nextTick()
    s.id.value = 'two'
    await nextTick()
    await nextTick()
    old.resolve({ reclaimableBytes: 999999 })
    await nextTick()
    await nextTick()
    expect(s.preview.value?.reclaimableBytes).toBe(8192)
    const closing = deferred<{ reclaimableBytes: number }>()
    mock.load.mockReturnValueOnce(closing.promise)
    s.id.value = 'three'
    await nextTick()
    s.open.value = false
    await nextTick()
    closing.resolve({ reclaimableBytes: 123 })
    await nextTick()
    await nextTick()
    expect(s.preview.value).toBeNull()
    const unmounting = deferred<{ reclaimableBytes: number }>()
    mock.load.mockReturnValueOnce(unmounting.promise)
    s.open.value = true
    await nextTick()
    s.scope.stop()
    unmounting.resolve({ reclaimableBytes: 456 })
    await nextTick()
    await nextTick()
    expect(s.preview.value).toBeNull()
  })
  it('shows an error without substituting downloaded bytes', async () => {
    mock.load.mockRejectedValue(new Error('unavailable'))
    const s = await setup()
    s.open.value = true
    await nextTick()
    await nextTick()
    await nextTick()
    expect(s.preview.value).toBeNull()
    expect(s.error.value).toBe('unknown')
    s.scope.stop()
  })
})
