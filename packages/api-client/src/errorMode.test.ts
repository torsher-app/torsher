import { describe, expect, it } from 'vitest'
import { createErrorModeStack } from './errorMode.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

describe('режим ошибок', () => {
  it('пересекающиеся вызовы возвращают режим по умолчанию', async () => {
    const modes = createErrorModeStack('toast')
    const first = deferred()
    const second = deferred()

    const a = modes.run('silent', () => first.promise)
    const b = modes.run('global', () => second.promise)

    expect(modes.current()).toBe('global')

    first.resolve()
    await a

    expect(modes.current()).toBe('global')

    second.resolve()
    await b

    expect(modes.current()).toBe('toast')
  })

  it('вложенный вызов действует внутри внешнего', async () => {
    const modes = createErrorModeStack('toast')

    await modes.run('silent', async () => {
      expect(modes.current()).toBe('silent')

      await modes.run('global', async () => {
        expect(modes.current()).toBe('global')
      })

      expect(modes.current()).toBe('silent')
    })

    expect(modes.current()).toBe('toast')
  })

  it('ошибка внутри вызова тоже убирает его режим', async () => {
    const modes = createErrorModeStack('toast')

    await expect(
      modes.run('silent', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(modes.current()).toBe('toast')
  })
})
