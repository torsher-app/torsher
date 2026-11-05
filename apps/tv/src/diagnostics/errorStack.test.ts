import { runInThisContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { createSafeErrorStackReader } from './errorStack.ts'
import { safeLocations } from './supportAssets.ts'

function replace<T>(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
  run: () => T,
): T {
  const previous = Object.getOwnPropertyDescriptor(target, key)
  try {
    if (descriptor)
      Object.defineProperty(target, key, { configurable: true, ...descriptor })
    else Reflect.deleteProperty(target, key)
    return run()
  }
  finally {
    if (previous)
      Object.defineProperty(target, key, previous)
    else Reflect.deleteProperty(target, key)
  }
}
function withoutFormatter<T>(run: () => T): T {
  return replace(Error, 'prepareStackTrace', { value: undefined }, run)
}

it('reads a native TypeError accessor into exact known asset locations', () => {
  const read = createSafeErrorStackReader()
  // Real V8 frames from a named synthetic emitted asset; no invented stack getter.
  const error = runInThisContext('new TypeError("SECRET")', {
    filename: 'https://tv.example/assets/native.js',
  })
  expect(Object.getOwnPropertyDescriptor(error, 'stack')?.get).toBeTypeOf(
    'function',
  )
  const stack = withoutFormatter(() => read(error))
  expect(stack).toContain('https://tv.example/assets/native.js')
  const result = safeLocations(
    stack,
    new Map([['https://tv.example/assets/native.js', 'a'.repeat(64)]]),
  )
  expect(result.locations[0]).toMatchObject({ assetId: 'a'.repeat(64) })
  expect(JSON.stringify(result)).not.toMatch(/SECRET|https:/)
})

it('preserves bounded own data stacks without invoking unrelated getters', () => {
  const read = createSafeErrorStackReader()
  const getter = vi.fn(() => {
    throw new Error('SECRET')
  })
  const value = Object.defineProperties(
    {},
    {
      stack: { value: 'x'.repeat(20000) },
      name: { get: getter },
      message: { get: getter },
    },
  )
  expect(read(value)).toHaveLength(16384)
  expect(getter).not.toHaveBeenCalled()
})

it.each(['name', 'message'])('never invokes an own %s getter', (key) => {
  const read = createSafeErrorStackReader()
  const error = new TypeError('SECRET')
  const getter = vi.fn(() => {
    throw new Error('SECRET getter')
  })
  Object.defineProperty(error, key, { get: getter })
  const result = withoutFormatter(() => read(error))
  expect(result).toBeUndefined()
  expect(getter).not.toHaveBeenCalled()
})

it('rejects inherited name getters and custom/cross-realm-like prototype chains', () => {
  const read = createSafeErrorStackReader()
  const error = new TypeError('SECRET')
  const getter = vi.fn(() => 'SECRET')
  const inherited = withoutFormatter(() =>
    replace(TypeError.prototype, 'name', { get: getter }, () => read(error)),
  )
  expect(inherited).toBeUndefined()
  expect(getter).not.toHaveBeenCalled()
  Object.setPrototypeOf(error, Object.create(TypeError.prototype))
  expect(withoutFormatter(() => read(error))).toBeUndefined()
})

it.each([Error, Function.prototype, Object.prototype])(
  'never invokes custom or inherited prepareStackTrace on %s',
  (target) => {
    const read = createSafeErrorStackReader()
    const callback = vi.fn(() => 'SECRET')
    const getter = vi.fn(() => callback)
    for (const descriptor of [{ value: callback }, { get: getter }]) {
      const result = replace(Error, 'prepareStackTrace', undefined, () =>
        replace(target, 'prepareStackTrace', descriptor, () =>
          read(new TypeError('SECRET'))))
      expect(result).toBeUndefined()
    }
    expect(callback).not.toHaveBeenCalled()
    expect(getter).not.toHaveBeenCalled()
  },
)

it('rejects spoofed stack accessors, coercion objects, oversized fields and descriptor failures', () => {
  const read = createSafeErrorStackReader()
  const getter = vi.fn(() => 'SECRET')
  const spoof = new TypeError('SECRET')
  Object.defineProperty(spoof, 'stack', { get: getter })
  expect(withoutFormatter(() => read(spoof))).toBeUndefined()
  expect(getter).not.toHaveBeenCalled()
  for (const message of [{ toString: getter }, 'x'.repeat(4097)]) {
    const error = new TypeError('fixture')
    Object.defineProperty(error, 'message', { value: message })
    expect(withoutFormatter(() => read(error))).toBeUndefined()
  }
  expect(getter).not.toHaveBeenCalled()
  const proxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error('SECRET')
      },
    },
  )
  expect(read(proxy)).toBeUndefined()
  const revoked = Proxy.revocable(new Error('fixture'), {})
  revoked.revoke()
  expect(read(revoked.proxy)).toBeUndefined()
})
