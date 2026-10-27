import type { NativeVideoState, PlayerSnapshot } from './nativeVideo.ts'
import { describe, expect, it } from 'vitest'
import {
  applySnapshot,
  currentTimeOf,
  INITIAL_SNAPSHOT,
} from './nativeVideo.ts'

function snapshot(patch: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return { ...INITIAL_SNAPSHOT, readyState: 4, duration: 100, ...patch }
}

function stateOf(
  patch: Partial<PlayerSnapshot>,
  paused = false,
): NativeVideoState {
  return { snapshot: snapshot(patch), receivedAt: 1000, paused }
}

describe('currentTimeOf', () => {
  it('досчитывает позицию между снимками, пока видео идёт', () => {
    expect(currentTimeOf(stateOf({ time: 10 }), 1500)).toBe(10.5)
    expect(currentTimeOf(stateOf({ time: 10, rate: 2 }), 1500)).toBe(11)
  })

  it('на паузе, при буферизации и в конце позиция стоит', () => {
    expect(currentTimeOf(stateOf({ time: 10 }, true), 3000)).toBe(10)
    expect(currentTimeOf(stateOf({ time: 10, readyState: 2 }), 3000)).toBe(10)
    expect(currentTimeOf(stateOf({ time: 10, ended: true }), 3000)).toBe(10)
  })

  it('не уходит дальше длительности', () => {
    expect(currentTimeOf(stateOf({ time: 99.9 }), 5000)).toBe(100)
  })

  it('пока плеер не подтвердил перемотку — целевая позиция', () => {
    const state = { ...stateOf({ time: 10 }), pendingSeek: 60 }

    expect(currentTimeOf(state, 5000)).toBe(60)
  })
})

describe('applySnapshot', () => {
  it('пауза и запуск меняются только событиями', () => {
    const state = stateOf({}, false)

    // Снимок, ушедший до play(), не возвращает паузу
    applySnapshot(state, snapshot({ paused: true }), 2000)
    expect(state.paused).toBe(false)

    applySnapshot(state, snapshot({ paused: true, events: ['pause'] }), 2100)
    expect(state.paused).toBe(true)

    applySnapshot(state, snapshot({ events: ['play', 'playing'] }), 2200)
    expect(state.paused).toBe(false)
  })

  it('перемотка, принятая плеером, снимает целевую позицию', () => {
    const state = { ...stateOf({ time: 10 }), pendingSeek: 60 }

    applySnapshot(state, snapshot({ time: 10, events: ['timeupdate'] }), 2000)
    expect(state.pendingSeek).toBe(60)

    applySnapshot(state, snapshot({ time: 60, events: ['seeking'] }), 2100)
    expect(state.pendingSeek).toBeUndefined()
    expect(currentTimeOf(state, 2100)).toBe(60)
  })

  it('новый поток сбрасывает паузу и перемотку', () => {
    const state = { ...stateOf({}, false), pendingSeek: 30 }

    applySnapshot(state, snapshot({ events: ['emptied'] }), 2000)
    expect(state.paused).toBe(true)
    expect(state.pendingSeek).toBeUndefined()
  })
})
