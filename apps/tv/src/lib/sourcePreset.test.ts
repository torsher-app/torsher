import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import { createSourcePresetStore } from './sourcePreset.ts'

function storage() {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
  }
}
const presets = {
  defaultId: 'default',
  effectiveId: 'default',
  items: [
    { id: 'default', name: 'Default' },
    { id: '4k', name: '4K' },
  ],
}

describe('viewer source preset', () => {
  it('isolates viewers and devices and persists explicit choices', () => {
    const device = storage()
    const first = createSourcePresetStore(() => device)
    const otherDevice = createSourcePresetStore(() => storage())
    const current = computed(() => first.get('viewer-a'))
    expect(current.value).toBeUndefined()
    first.set('viewer-a', '4k')
    expect(current.value).toBe('4k')
    expect(first.get('viewer-b')).toBeUndefined()
    expect(otherDevice.get('viewer-a')).toBeUndefined()
    expect(createSourcePresetStore(() => device).get('viewer-a')).toBe('4k')
    first.set('viewer-a', undefined)
    expect(device.entries.size).toBe(0)
  })

  it('keeps the selection in memory when storage is unavailable', () => {
    const store = createSourcePresetStore(() => {
      throw new Error('Storage is blocked')
    })
    expect(store.get('viewer')).toBeUndefined()
    store.set('viewer', '4k')
    expect(store.get('viewer')).toBe('4k')
    store.set('viewer', undefined)
    expect(store.get('viewer')).toBeUndefined()
  })

  it('deletion restores default inheritance, never stores the fallback ID', () => {
    const device = storage()
    const store = createSourcePresetStore(() => device)
    store.set('viewer', 'gone')
    store.reconcile('viewer', 'gone', presets)
    expect(store.get('viewer')).toBeUndefined()
    expect(device.entries.size).toBe(0)
    store.reconcile('viewer', undefined, {
      ...presets,
      defaultId: '4k',
      effectiveId: '4k',
    })
    expect(store.get('viewer')).toBeUndefined()
  })

  it('does not clear a newer choice or reinterpret an old server response', () => {
    const store = createSourcePresetStore(storage)
    store.set('viewer', '4k')
    store.reconcile('viewer', 'gone', presets)
    expect(store.get('viewer')).toBe('4k')
    store.reconcile('viewer', '4k', undefined)
    expect(store.get('viewer')).toBe('4k')
  })
})
