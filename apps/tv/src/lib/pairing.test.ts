import { describe, expect, it } from 'vitest'
import {
  formatCode,
  panelAddress,
  POLL_BACKOFF_MS,
  POLL_MS,
  pollStep,
} from './pairing.ts'

describe('formatCode', () => {
  it('делит код на тройки', () => {
    expect(formatCode('ABCDEF')).toBe('ABC DEF')
  })
})

describe('panelAddress', () => {
  it('адрес панели рядом с витриной, без протокола и хэша', () => {
    expect(
      panelAddress({ href: 'http://192.168.1.10:8080/?platform=tv#/connect' }),
    ).toBe('192.168.1.10:8080/panel')
  })

  it('за прокси с подпутём', () => {
    expect(panelAddress({ href: 'https://media.example.com/torsher/#/' })).toBe(
      'media.example.com/torsher/panel',
    )
  })
})

describe('pollStep', () => {
  it('ждёт подтверждения', () => {
    expect(pollStep({ status: 'pending' })).toEqual({
      kind: 'wait',
      ms: POLL_MS,
    })
    expect(pollStep({ status: 'approved' })).toEqual({ kind: 'approved' })
  })

  it('истёкший или забытый код меняет на новый', () => {
    expect(pollStep({ status: 'expired' })).toEqual({ kind: 'restart' })
    expect(pollStep({ error: 404 })).toEqual({ kind: 'restart' })
  })

  it('без ответа и при лимите опрашивает реже', () => {
    expect(pollStep({ error: undefined })).toEqual({
      kind: 'wait',
      ms: POLL_BACKOFF_MS,
    })
    expect(pollStep({ error: 429 })).toEqual({
      kind: 'wait',
      ms: POLL_BACKOFF_MS,
    })
  })
})
