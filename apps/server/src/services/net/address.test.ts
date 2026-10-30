import { describe, expect, it } from 'vitest'
import {
  isLocalHostname,
  isLoopbackHostname,
  isMdnsHostname,
} from './address.ts'

describe('isLocalHostname', () => {
  it.each([
    '0:0:0:0:0:ffff:7f00:1',
    '0:0:0:0:0:0:0:1',
    '0:0:0:0:0:ffff:a9fe:a9fe',
    '0:0:0:0:0:0:0:0',
    'fe80::1%en0',
  ])('bare address %s from a resolver is local', (address) => {
    expect(isLocalHostname(address)).toBe(true)
  })

  it.each([
    'localhost',
    'LOCALHOST.',
    'foo.localhost',
    '127.0.0.1',
    '127.8.9.10',
    '2130706433',
    '0x7f.1',
    '127.1',
    '0.0.0.0',
    '169.254.169.254',
    '[::1]',
    '[::]',
    '[fe80::1]',
    '[febf::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]',
    '[::ffff:169.254.1.1]',
  ])('%s is local', (host) => {
    expect(isLocalHostname(host)).toBe(true)
    expect(isLocalHostname(new URL(`http://${host}:9117/x`).hostname)).toBe(
      true,
    )
  })

  it.each([
    '192.168.1.5',
    '10.0.0.1',
    '172.16.0.1',
    'jackett',
    'example.com',
    'localhost.example.com',
    '[2001:db8::1]',
    '[fec0::1]',
    '[::ffff:192.168.1.5]',
  ])('%s is not local', (host) => {
    expect(isLocalHostname(host)).toBe(false)
  })
})

describe('isLoopbackHostname', () => {
  it.each([
    'localhost',
    'LOCALHOST.',
    'prowlarr.localhost',
    '127.0.0.1',
    '127.0.1.1',
    '127.1',
    '2130706433',
    '0.0.0.0',
    '[::1]',
    '[::]',
    '[::ffff:127.0.0.1]',
  ])('%s is the server itself', (host) => {
    expect(isLoopbackHostname(new URL(`http://${host}:9696`).hostname)).toBe(
      true,
    )
  })

  it.each([
    '169.254.169.254',
    '[fe80::1]',
    '192.168.1.10',
    'prowlarr',
    'host.docker.internal',
    'localhost.example.com',
    'raspberrypi.local',
    '[2001:db8::1]',
    '[::ffff:192.168.1.10]',
  ])('%s is not the server itself', (host) => {
    expect(isLoopbackHostname(new URL(`http://${host}:9696`).hostname)).toBe(
      false,
    )
  })
})

describe('isMdnsHostname', () => {
  it.each(['raspberrypi.local', 'NAS.LOCAL', 'nas.local.'])(
    '%s is an mDNS name',
    (host) => {
      expect(isMdnsHostname(new URL(`http://${host}:9696`).hostname)).toBe(
        true,
      )
    },
  )

  it.each(['local', 'prowlarr', 'nas.local.example.com', '192.168.1.10'])(
    '%s is not an mDNS name',
    (host) => {
      expect(isMdnsHostname(host)).toBe(false)
    },
  )
})
