import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { users } from '../../db/schema.ts'
import { createOwner, needsSetup, SetupDoneError } from './index.ts'

function user(email: string) {
  return { name: 'User', email, passwordHash: 'hash' }
}

beforeAll(async () => {
  await migrateDb()
})

beforeEach(() => {
  getDb().delete(users).run()
})

describe('createOwner', () => {
  it('создаёт первый аккаунт и не даёт создать второй', () => {
    expect(needsSetup()).toBe(true)
    expect(createOwner(user('owner@example.com')).email).toBe(
      'owner@example.com',
    )
    expect(needsSetup()).toBe(false)
    expect(() => createOwner(user('second@example.com'))).toThrow(
      SetupDoneError,
    )
    expect(getDb().select().from(users).all()).toHaveLength(1)
  })
})
