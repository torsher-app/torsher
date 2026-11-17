import type { Torrent } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { useDownloadSelection } from './useDownloadSelection'

function torrent(selected: number[] = [], id = 'one'): Torrent {
  return {
    id,
    files: [0, 1].map(index => ({
      index,
      selected: selected.includes(index),
      isVideo: true,
      priority: 'medium',
    })),
  } as Torrent
}

function setup(preselect = false) {
  const source = shallowRef<Torrent | null>(torrent())
  const preset = ref(preselect)
  const scope = effectScope()
  const draft = scope.run(() =>
    useDownloadSelection(
      () => source.value,
      () => preset.value,
    ),
  )!
  async function update(value: Torrent | null) {
    source.value = value
    await nextTick()
  }
  return { ...draft, source, scope, update }
}

describe('download card selection', () => {
  it('follows Keep and unkeep server selection without reopening', async () => {
    const s = setup()
    await s.update(torrent([0]))
    expect([...s.selection.value]).toEqual([0])
    await s.update(torrent())
    expect([...s.selection.value]).toEqual([])
    s.scope.stop()
  })
  it('preserves an unsaved selection through polling and Keep', async () => {
    const s = setup()
    s.selection.value = new Set([1])
    await s.update(torrent())
    await s.update(torrent([0]))
    expect([...s.selection.value]).toEqual([1])
    s.scope.stop()
  })
  it('preserves preselected videos before download', async () => {
    const s = setup(true)
    await s.update(torrent())
    expect([...s.selection.value]).toEqual([0, 1])
    s.scope.stop()
  })
  it('keeps pending priorities when selection has returned to the server value', async () => {
    const s = setup()
    s.draftPriorities.value = new Map([[0, 'high']])
    await s.update(torrent([0]))
    expect(s.draftPriorities.value.get(0)).toBe('high')
    expect([...s.selection.value]).toEqual([])
    s.scope.stop()
  })
  it('resets drafts on reopening and switching torrents', async () => {
    const s = setup()
    s.selection.value = new Set([1])
    s.draftPriorities.value = new Map([[1, 'low']])
    await s.update(null)
    await s.update(torrent([0]))
    expect([...s.selection.value]).toEqual([0])
    expect(s.draftPriorities.value.size).toBe(0)
    await s.update(torrent([1], 'two'))
    expect([...s.selection.value]).toEqual([1])
    s.scope.stop()
  })
  it('resumes sync after the server accepts the draft', async () => {
    const s = setup()
    s.selection.value = new Set([1])
    await s.update(torrent([1]))
    await s.update(torrent([0, 1]))
    expect([...s.selection.value]).toEqual([0, 1])
    s.scope.stop()
  })
  it('does not reapply preselect when unkeep clears an accepted download', async () => {
    const s = setup(true)
    await s.update(torrent([0, 1]))
    await s.update(torrent())
    expect([...s.selection.value]).toEqual([])
    s.scope.stop()
  })
  it('preselects videos when magnet metadata arrives', async () => {
    const s = setup(true)
    await s.update({ ...torrent(), files: [] })
    await s.update(torrent())
    expect([...s.selection.value]).toEqual([0, 1])
    s.scope.stop()
  })
})
