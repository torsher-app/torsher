import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkStartupConfig, config } from './config.ts'

describe('config.secretKey', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('rejects the placeholder key in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SECRET_KEY', 'change-me-in-production')

    expect(() => config.secretKey).toThrow(/SECRET_KEY/)
  })

  it('rejects a short key in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SECRET_KEY', 'a'.repeat(31))

    expect(() => config.secretKey).toThrow(/SECRET_KEY/)
  })

  it('accepts a long random key in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SECRET_KEY', 'f'.repeat(64))

    expect(config.secretKey).toBe('f'.repeat(64))
  })

  it('accepts the placeholder outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SECRET_KEY', 'change-me-in-production')

    expect(config.secretKey).toBe('change-me-in-production')
  })
})

describe('config.trustProxy', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    [undefined, false],
    ['', false],
    ['true', true],
    ['1', true],
    ['TRUE', true],
    ['On', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['OFF', false],
    ['No', false],
    ['loopback', 'loopback'],
    ['10.0.0.0/8, 127.0.0.1', '10.0.0.0/8, 127.0.0.1'],
  ])('reads TRUST_PROXY=%s', (value, expected) => {
    if (value === undefined)
      vi.stubEnv('TRUST_PROXY', undefined)
    else vi.stubEnv('TRUST_PROXY', value)

    expect(config.trustProxy).toBe(expected)
  })
})

describe('checkStartupConfig', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('accepts proxy addresses, subnets and names', () => {
    vi.stubEnv('TRUST_PROXY', 'loopback, 10.0.0.0/8, fd00::1')

    expect(() => checkStartupConfig()).not.toThrow()
  })

  it('rejects a TRUST_PROXY that is not an address', () => {
    vi.stubEnv('TRUST_PROXY', 'my-proxy')

    expect(() => checkStartupConfig()).toThrow(/TRUST_PROXY/)
  })

  it('rejects a weak SECRET_KEY in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SECRET_KEY', 'change-me-in-production')

    expect(() => checkStartupConfig()).toThrow(/SECRET_KEY/)
  })
})
