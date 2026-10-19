import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.ts'

describe('password', () => {
  it('подтверждает верный пароль', async () => {
    const hash = await hashPassword('correct-horse-battery')

    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true)
  })

  it('отвергает неверный пароль', async () => {
    const hash = await hashPassword('correct-horse-battery')

    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('отвергает хеш неизвестного формата', async () => {
    expect(await verifyPassword('any', 'plain-text-hash')).toBe(false)
  })
})
