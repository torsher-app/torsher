import { describe, expect, it } from 'vitest'
import {
  createCord,
  lampMode,
  lampWeight,
  MAX_MOTHS,
  mothOrbit,
  mothPath,
  stepCord,
  swarmChange,
  tugCord,
  tugsBetween,
  WAIT_EMBER_AT,
  WAIT_FADE_AT,
  WAIT_PERIOD,
  waitGlow,
} from './lamp.ts'

describe('lampWeight', () => {
  it('keeps the icon line up to 48 and thins out on larger lamps', () => {
    expect(lampWeight(24).line).toBe(2)
    expect(lampWeight(48).line).toBe(2)
    expect(lampWeight(96).line).toBe(1.6)
    expect(lampWeight(144).line).toBe(1.6)
    expect(lampWeight(200).line).toBe(1.3)
  })

  it('hangs the cord from the lower edge of the shade line', () => {
    expect(lampWeight(40).anchorY).toBeCloseTo(11.4)
    expect(lampWeight(200).anchorY).toBeCloseTo(11.05)
  })
})

describe('lampMode', () => {
  it('lights only while data flows', () => {
    expect(lampMode('buffering')).toBe('peers')
    expect(lampMode('slow')).toBe('peers')
    expect(lampMode('connecting')).toBe('noPeers')
    expect(lampMode('waitingPeers')).toBe('noPeers')
    expect(lampMode('reconnecting')).toBe('noPeers')
  })
})

describe('cord', () => {
  function run(seconds: number, from = 0) {
    const cord = createCord()

    tugCord(cord, 2.4, from)

    let now = from
    let deepest = 0

    while (now < from + seconds) {
      now += 0.016
      stepCord(cord, 0.016, now)
      deepest = Math.max(deepest, cord.pull)
    }

    return { cord, deepest }
  }

  it('pulls most of the way down while held', () => {
    expect(run(0.13).deepest).toBeGreaterThan(1.8)
  })

  it('springs back and stops swinging after release', () => {
    const { cord } = run(4)

    expect(Math.abs(cord.pull)).toBeLessThan(0.05)
    expect(Math.abs(cord.swing)).toBeLessThan(1)
  })

  it('swings after release', () => {
    let peak = 0
    const cord = createCord()

    tugCord(cord, 2.4, 0)

    for (let now = 0.016; now < 1; now += 0.016) {
      stepCord(cord, 0.016, now)
      peak = Math.max(peak, Math.abs(cord.swing))
    }

    expect(peak).toBeGreaterThan(5)
  })
})

describe('tugsBetween', () => {
  it('fires the first tug when the cycle starts', () => {
    expect(tugsBetween(-1, 0)).toEqual([1.4])
  })

  it('returns every tug crossed in one step', () => {
    expect(tugsBetween(1.9, 2.5)).toEqual([2, 2])
  })

  it('carries over the cycle boundary', () => {
    expect(tugsBetween(WAIT_PERIOD - 0.1, 0.05)).toEqual([1.4])
  })

  it('returns nothing between tugs', () => {
    expect(tugsBetween(0.1, 1.9)).toEqual([])
  })
})

describe('waitGlow', () => {
  it('stays dark between tugs before the ember', () => {
    expect(waitGlow(1, 5, 0)).toBe(0)
  })

  it('flickers right after a tug', () => {
    expect(waitGlow(1, 0.02, 0)).toBeGreaterThan(0.3)
    expect(waitGlow(1, 0.08, 0)).toBeLessThan(0.1)
    expect(waitGlow(1, 0.14, 0)).toBeGreaterThan(0.15)
  })

  it('smoulders after the third series and never lights up fully', () => {
    for (let now = 0; now < 5; now += 0.1) {
      const glow = waitGlow(WAIT_EMBER_AT + 1, 5, now)

      expect(glow).toBeGreaterThan(0)
      expect(glow).toBeLessThan(0.35)
    }
  })

  it('fades out by the end of the cycle', () => {
    expect(waitGlow(WAIT_FADE_AT + 1.5, 5, 0)).toBe(0)
  })
})

describe('swarmChange', () => {
  it('calls and releases moths one at a time', () => {
    expect(swarmChange(0, 3)).toBe(1)
    expect(swarmChange(5, 2)).toBe(-1)
    expect(swarmChange(4, 4)).toBe(0)
  })

  it('caps the swarm', () => {
    expect(swarmChange(MAX_MOTHS, 40)).toBe(0)
    expect(swarmChange(0, -1)).toBe(0)
  })
})

describe('mothOrbit', () => {
  it('circles the shade', () => {
    const path = mothPath(() => 0.5)

    for (let t = 0; t < 10; t += 0.5) {
      const [x, y] = mothOrbit(path, t)

      expect(Math.abs(x - 12)).toBeLessThan(path.rx + 0.5)
      expect(Math.abs(y - path.centerY)).toBeLessThan(path.ry + 0.5)
    }
  })
})
