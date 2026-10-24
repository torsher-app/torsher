import { describe, expect, it } from 'vitest'
import { failureOf } from './snapshot.ts'
import { WORKER_RESULT_TYPE, workerResultOf } from './worker-message.ts'

describe('сообщения рабочего потока', () => {
  it('служебные сообщения Node под --watch не принимаются за результат', () => {
    expect(workerResultOf({ 'watch:require': ['/app/x.ts'] })).toBeUndefined()
    expect(
      workerResultOf({ 'watch:import': ['file:///app/x.ts'] }),
    ).toBeUndefined()
    expect(workerResultOf({ ok: true })).toBeUndefined()
    expect(workerResultOf(null)).toBeUndefined()
    expect(
      workerResultOf({ type: WORKER_RESULT_TYPE, result: { ok: true } }),
    ).toEqual({ ok: true })
  })

  it('отказ потока сохраняет код и текст ошибки', () => {
    const error = failureOf({
      ok: false,
      kind: 'io',
      code: 'EACCES',
      message: 'permission denied, open snapshot.db',
    })

    expect(error).toMatchObject({
      kind: 'io',
      params: {
        code: 'EACCES',
        detail: 'permission denied, open snapshot.db',
      },
    })
    expect(
      failureOf({ ok: false, kind: 'io', code: 'ENOSPC', message: 'full' }),
    ).toMatchObject({ kind: 'no_space', params: { detail: 'full' } })
  })
})
