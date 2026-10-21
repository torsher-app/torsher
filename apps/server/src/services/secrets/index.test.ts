import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decryptSecret,
  decryptWith,
  encryptSecret,
  encryptWith,
  loadSecretKey,
  SecretError,
} from './index.ts'

const dirs: string[] = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'torsher-secrets-'))

  dirs.push(dir)

  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('шифрование', () => {
  const key = loadSecretKey({ secret: 'one' })

  it('расшифровывает то, что зашифровало', () => {
    const ciphertext = encryptWith(key, 'api-key-123')

    expect(ciphertext).not.toContain('api-key-123')
    expect(decryptWith(key, ciphertext)).toBe('api-key-123')
  })

  it('даёт разный шифртекст для одного значения', () => {
    expect(encryptWith(key, 'same')).not.toBe(encryptWith(key, 'same'))
  })

  it('с чужим ключом бросает ошибку, а не мусор', () => {
    const ciphertext = encryptWith(key, 'api-key-123')

    expect(() =>
      decryptWith(loadSecretKey({ secret: 'two' }), ciphertext),
    ).toThrow(SecretError)
  })

  it('на испорченном шифртексте бросает ошибку', () => {
    const [version, iv, tag] = encryptWith(key, 'api-key-123').split(':')

    expect(() =>
      decryptWith(key, [version, iv, tag, 'AAAA'].join(':')),
    ).toThrow(SecretError)
    expect(() => decryptWith(key, 'plain-text')).toThrow(SecretError)
  })

  it('модульные функции берут ключ из окружения', () => {
    expect(decryptSecret(encryptSecret('value'))).toBe('value')
  })
})

describe('loadSecretKey', () => {
  it('создаёт файл ключа с правами 0600 и читает его повторно', () => {
    const filePath = join(tempDir(), 'nested', 'secret.key')
    const first = loadSecretKey({ filePath })

    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(loadSecretKey({ filePath })).toEqual(first)
    expect(first).toHaveLength(32)
  })

  it('предпочитает TORSHER_SECRET файлу', () => {
    const filePath = join(tempDir(), 'secret.key')
    const fromSecret = loadSecretKey({ secret: 'value', filePath })

    expect(fromSecret).toEqual(loadSecretKey({ secret: 'value' }))
    expect(() => readFileSync(filePath)).toThrow()
  })

  it('не принимает испорченный файл ключа', () => {
    const filePath = join(tempDir(), 'secret.key')

    // Короткий ключ вместо 32 байт
    writeFileSync(filePath, 'c2hvcnQ=')

    expect(() => loadSecretKey({ filePath })).toThrow(SecretError)
  })

  it('без секрета и файла бросает ошибку', () => {
    expect(() => loadSecretKey({})).toThrow(SecretError)
  })
})
