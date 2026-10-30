import { describe, expect, it } from 'vitest'
import { LogRing, parseLine } from './ring.ts'

function line(fields: Record<string, unknown>) {
  return JSON.stringify({
    level: 30,
    time: Date.UTC(2026, 9, 22),
    pid: 1,
    hostname: 'h',
    ...fields,
  })
}

describe('разбор строки', () => {
  it('уровни pino, источник по умолчанию, детали и контекст', () => {
    expect(parseLine(line({ level: 10, msg: 'a' }))).toMatchObject({
      level: 'debug',
      source: 'server',
      message: 'a',
    })
    expect(parseLine(line({ level: 60 }))).toMatchObject({
      level: 'error',
      message: '',
    })
    expect(
      parseLine(
        line({
          level: 50,
          source: 'engine',
          msg: 'boom',
          reqId: 'r1',
          err: { message: 'x', stack: 'Error: x\n  at y' },
          torrentId: 't1',
          code: 2,
          ok: true,
          ids: ['a', 'b'],
          nested: { a: 1 },
          long: 'z'.repeat(600),
        }),
      ),
    ).toEqual({
      time: '2026-10-22T00:00:00.000Z',
      level: 'error',
      source: 'engine',
      message: 'boom',
      details: 'Error: x\n  at y',
      context: {
        torrentId: 't1',
        code: 2,
        ok: true,
        ids: 'a, b',
        long: 'z'.repeat(500),
      },
    })
  })

  it('битая строка пропускается', () => {
    expect(parseLine('{oops')).toBeUndefined()
    expect(parseLine('[1]')).toBeUndefined()
  })
})

describe('кольцевой буфер', () => {
  it('держит последние записи и не сбрасывает номера', () => {
    const ring = new LogRing(3)

    for (let i = 1; i <= 5; i++) ring.push(line({ msg: `m${i}` }))

    expect(
      ring.query().entries.map(entry => [entry.seq, entry.message]),
    ).toEqual([
      [5, 'm5'],
      [4, 'm4'],
      [3, 'm3'],
    ])
  })

  it('склеивает подряд идущие одинаковые записи без деталей', () => {
    const ring = new LogRing()

    ring.push(line({ msg: 'same', time: 1 }))
    ring.push(line({ msg: 'same', time: 2 }))
    ring.push(line({ msg: 'same', time: 3 }))
    ring.push(line({ msg: 'same', level: 40 }))
    ring.push(line({ msg: 'same', level: 40, details: 'd' }))
    ring.push(line({ msg: 'same', level: 40, details: 'd' }))

    const { entries } = ring.query()

    expect(
      entries.map(entry => [entry.message, entry.level, entry.repeat]),
    ).toEqual([
      ['same', 'warn', undefined],
      ['same', 'warn', undefined],
      ['same', 'warn', undefined],
      ['same', 'info', 3],
    ])
    expect(entries[3]!.time).toBe(new Date(3).toISOString())
  })

  it('не склеивает записи с разным контекстом', () => {
    const ring = new LogRing()

    ring.push(line({ msg: 'restore failed', torrentId: 'a' }))
    ring.push(line({ msg: 'restore failed', torrentId: 'b' }))
    ring.push(line({ msg: 'restore failed', torrentId: 'b', code: 1 }))
    ring.push(line({ code: 1, msg: 'restore failed', torrentId: 'b' }))

    expect(
      ring.query().entries.map(entry => [entry.context, entry.repeat]),
    ).toEqual([
      [{ torrentId: 'b', code: 1 }, 2],
      [{ torrentId: 'b' }, undefined],
      [{ torrentId: 'a' }, undefined],
    ])
  })

  it('склеенная запись сохраняет id и получает новый seq', () => {
    const ring = new LogRing()

    ring.push(line({ msg: 'same' }))
    ring.push(line({ msg: 'other' }))
    ring.push(line({ msg: 'same' }))

    const cursor = ring.query().entries[0]!.seq

    ring.push(line({ msg: 'same' }))

    const newer = ring.query({ after: cursor }).entries

    expect(
      newer.map(entry => [entry.id, entry.seq, entry.message, entry.repeat]),
    ).toEqual([[3, 4, 'same', 2]])
    expect(ring.query().entries.map(entry => [entry.id, entry.seq])).toEqual([
      [3, 4],
      [2, 2],
      [1, 1],
    ])
  })

  it('фильтры: уровень, источники, подстрока', () => {
    const ring = new LogRing()

    ring.push(line({ msg: 'Engine crashed', level: 50, source: 'engine' }))
    ring.push(line({ msg: 'Cache evicted', level: 40, source: 'storage' }))
    ring.push(line({ msg: 'request', level: 20 }))
    ring.push(line({ msg: 'ENGINE ready', level: 30, source: 'engine' }))

    const messages = (query: Parameters<LogRing['query']>[0]) =>
      ring.query(query).entries.map(entry => entry.message)

    expect(messages({ level: 'warn' })).toEqual([
      'Cache evicted',
      'Engine crashed',
    ])
    expect(messages({ sources: ['engine', 'storage'], level: 'info' })).toEqual(
      ['ENGINE ready', 'Cache evicted', 'Engine crashed'],
    )
    expect(messages({ q: 'engine' })).toEqual([
      'ENGINE ready',
      'Engine crashed',
    ])
  })

  it('подстрока находит и значение поля', () => {
    const ring = new LogRing()

    ring.push(line({ msg: 'pieces failed hash check', infoHash: 'ABCDEF01' }))
    ring.push(line({ msg: 'playback s1: direct', fileIndex: 3 }))
    ring.push(line({ msg: 'Cache evicted' }))

    const messages = (q: string) =>
      ring.query({ q }).entries.map(entry => entry.message)

    expect(messages('abcdef')).toEqual(['pieces failed hash check'])
    expect(messages('3')).toEqual(['playback s1: direct'])
  })

  it('курсоры before и after и признак продолжения', () => {
    const ring = new LogRing()

    for (let i = 1; i <= 10; i++) ring.push(line({ msg: `m${i}` }))

    const seqs = (query: Parameters<LogRing['query']>[0]) => {
      const result = ring.query(query)

      return [result.entries.map(entry => entry.seq), result.hasMore]
    }

    expect(seqs({ limit: 3 })).toEqual([[10, 9, 8], true])
    expect(seqs({ limit: 3, before: 8 })).toEqual([[7, 6, 5], true])
    expect(seqs({ limit: 5, before: 6 })).toEqual([[5, 4, 3, 2, 1], false])
    // Живое обновление дочитывает новые от курсора без пропусков
    expect(seqs({ limit: 3, after: 5 })).toEqual([[8, 7, 6], true])
    expect(seqs({ limit: 3, after: 8 })).toEqual([[10, 9], false])
    expect(seqs({ limit: 1000 })[0]).toHaveLength(10)
  })
})
