import { describe, expect, it } from 'vitest'
import { indexerUpdateBody, isSessionCookie } from './sourceForms'

describe('torznab session cookie form', () => {
  it.each([
    'sid=abc',
    'sid=abc=def; other="xyz"',
    'empty=',
    `sid=${'x'.repeat(8188)}`,
  ])('accepts Cookie pairs: %s', (value) => {
    expect(isSessionCookie(value)).toBe(true)
  })
  it.each([
    '',
    'cookie',
    'sid=x\r\nHeader: x',
    'sid=x\x00',
    'sid=\tx',
    'sid=x\x7F',
    'sid=with space',
    'sid=x;',
    'cf_clearance=challenge',
    `sid=${'x'.repeat(8189)}`,
  ])('rejects invalid input', (value) => {
    expect(isSessionCookie(value)).toBe(false)
  })
  it('keeps managed fields out of the request, keeps a blank cookie and makes removal explicit', () => {
    const values = {
      name: 'Managed',
      apiKey: 'must-not-save',
      sessionCookie: '',
      removeCookie: false,
    }
    expect(indexerUpdateBody(values, true)).toEqual({
      sessionCookie: undefined,
    })
    expect(indexerUpdateBody({ ...values, removeCookie: true }, true)).toEqual({
      sessionCookie: null,
    })
    expect(
      indexerUpdateBody({ ...values, sessionCookie: 'sid=new' }, true),
    ).toEqual({ sessionCookie: 'sid=new' })
    expect(indexerUpdateBody(values, false)).toEqual({
      name: 'Managed',
      apiKey: 'must-not-save',
      sessionCookie: undefined,
    })
  })
})
