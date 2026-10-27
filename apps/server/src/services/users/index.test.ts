import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { users } from '../../db/schema.ts'
import { createOwner, needsSetup, SetupDoneError } from './index.ts'

function user(username: string) {
  return { username, passwordHash: 'hash' }
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
    expect(createOwner(user('Owner')).username).toBe('Owner')
    expect(needsSetup()).toBe(false)
    expect(() => createOwner(user('Second'))).toThrow(SetupDoneError)
    expect(getDb().select().from(users).all()).toHaveLength(1)
  })
})
