import { hash, verify } from '@node-rs/argon2'

// Алгоритм по умолчанию в @node-rs/argon2 — argon2id: его const enum
// нельзя импортировать при verbatimModuleSyntax, поэтому он не передаётся явно
const ARGON2ID_PREFIX = '$argon2id$'
const MEMORY_COST = 19_456
const TIME_COST = 2

export function hashPassword(password: string) {
  return hash(password, {
    memoryCost: MEMORY_COST,
    timeCost: TIME_COST,
  })
}

export async function verifyPassword(password: string, storedHash: string) {
  if (!storedHash.startsWith(ARGON2ID_PREFIX))
    return false

  try {
    return await verify(storedHash, password)
  }
  catch {
    return false
  }
}
