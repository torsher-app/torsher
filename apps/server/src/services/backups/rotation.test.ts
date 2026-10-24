import type { BackupReason } from './names.ts'
import type { BackupState } from './schedule.ts'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatBackupName, parseBackupName } from './names.ts'
import { selectForDeletion } from './rotation.ts'
import { isDue, nextRunAt, slotFor } from './schedule.ts'

// Дни, недели и слоты считаются по местному времени процесса: зона
// фиксирована, с переводом часов 25 октября 2026 (03:00 → 02:00)
const previousTz = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'Europe/Berlin'
})

afterAll(() => {
  if (previousTz === undefined)
    delete process.env.TZ
  else process.env.TZ = previousTz
})

/** Местное время `YYYY-MM-DD HH:mm` */
function local(value: string) {
  const [date, time = '00:00'] = value.split(' ')
  const [y, m, d] = date!.split('-').map(Number) as [number, number, number]
  const [h, min] = time.split(':').map(Number) as [number, number]

  return new Date(y, m - 1, d, h, min)
}

function item(at: string, reason: BackupReason = 'scheduled') {
  return parseBackupName(
    formatBackupName({
      createdAt: local(at),
      reason,
      version: '1.0.0',
      encrypted: false,
    }),
  )!
}

function kept(items: ReturnType<typeof item>[], daily: number, weekly: number) {
  const deleted = new Set(selectForDeletion(items, { daily, weekly }))

  return items
    .filter(entry => !deleted.has(entry.name))
    .map(entry => entry.createdAt)
}

describe('зона тестов', () => {
  it('местное время — Европа/Берлин', () => {
    expect(new Date('2026-07-01T12:00:00Z').getHours()).toBe(14)
    expect(new Date('2026-12-01T12:00:00Z').getHours()).toBe(13)
  })
})

describe('имена копий', () => {
  it('разбор строгий: чужие файлы и обход каталога — не копия', () => {
    expect(
      parseBackupName(
        'torsher-backup-20261024T040000Z-manual-v1.0.0-beta.1.db.gz.enc',
      ),
    ).toMatchObject({
      reason: 'manual',
      version: '1.0.0-beta.1',
      encrypted: true,
    })
    expect(
      parseBackupName('../torsher-backup-20261024T040000Z-manual-v1.0.0.db.gz'),
    ).toBeUndefined()
    expect(
      parseBackupName('torsher-backup-20261024T040000Z-manual-v1.0.0.db.gz/x'),
    ).toBeUndefined()
    expect(
      parseBackupName('torsher-backup-20261024T040000Z-weekly-v1.0.0.db.gz'),
    ).toBeUndefined()
    expect(
      parseBackupName(
        'torsher-backup-20261024T040000Z-manual-v1.0.0.db.gz.tmp',
      ),
    ).toBeUndefined()
  })
})

describe('ротация', () => {
  it('7 + 4: по копии на каждый из 7 дней и на 4 более ранние недели', () => {
    // Копии каждый день в 04:00 с 1 сентября по 24 октября 2026
    const items = Array.from({ length: 54 }, (_, i) => {
      const day = local('2026-09-01 04:00')

      day.setDate(day.getDate() + i)

      return item(
        `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()} 04:00`,
      )
    })
    const result = kept(items, 7, 4)

    expect(result.filter(date => date >= local('2026-10-18'))).toHaveLength(
      7,
    )
    // Неделя 12–18 октября (неделя самой старой дневной копии) пропускается,
    // дальше — самая новая копия каждой из четырёх предыдущих недель
    expect(result.filter(date => date < local('2026-10-18'))).toEqual([
      local('2026-09-20 04:00'),
      local('2026-09-27 04:00'),
      local('2026-10-04 04:00'),
      local('2026-10-11 04:00'),
    ])
    expect(result).toHaveLength(11)
  })

  it('пропуски дней: берутся дни, в которые копии есть', () => {
    const items = [
      item('2026-10-24 04:00'),
      item('2026-10-24 12:00', 'scheduled'),
      item('2026-10-20 04:00'),
      item('2026-10-10 04:00'),
      item('2026-10-01 04:00'),
    ]
    const deleted = selectForDeletion(items, { daily: 3, weekly: 0 })

    // В день 24-го остаётся самая новая
    expect(deleted.map(name => parseBackupName(name)!.createdAt)).toEqual([
      local('2026-10-24 04:00'),
      local('2026-10-01 04:00'),
    ])
  })

  it('перевод часов: две копии в одни местные сутки 25 октября — остаётся одна', () => {
    const items = [
      item('2026-10-25 02:30'),
      // Тот же местный час после перевода — другой момент UTC
      parseBackupName(
        formatBackupName({
          createdAt: new Date(
            local('2026-10-25 02:30').getTime() + 60 * 60 * 1000,
          ),
          reason: 'scheduled',
          version: '1.0.0',
          encrypted: false,
        }),
      )!,
      item('2026-10-24 04:00'),
    ]

    expect(items[0]!.name).not.toBe(items[1]!.name)
    expect(selectForDeletion(items, { daily: 2, weekly: 0 })).toEqual([
      items[0]!.name,
    ])
  })

  it('переход недели: воскресенье и понедельник — разные ISO-недели', () => {
    const items = [
      item('2026-10-20 04:00'),
      item('2026-10-12 04:00'),
      item('2026-10-11 04:00'),
      item('2026-10-05 04:00'),
    ]

    expect(kept(items, 1, 2)).toEqual([
      local('2026-10-20 04:00'),
      local('2026-10-12 04:00'),
      local('2026-10-11 04:00'),
    ])
  })

  it('pre-* — по три последних, ручные, загруженные и чужие не трогаются', () => {
    const items = [
      ...['01', '02', '03', '04', '05'].map(day =>
        item(`2026-10-${day} 04:00`, 'pre-update'),
      ),
      ...['01', '02', '03', '04'].map(day =>
        item(`2026-10-${day} 05:00`, 'pre-restore'),
      ),
      item('2026-01-01 04:00', 'manual'),
      item('2025-01-01 04:00', 'uploaded'),
    ]
    const deleted = selectForDeletion(items, { daily: 1, weekly: 0 }).map(
      name => parseBackupName(name)!,
    )

    expect(
      deleted.map(entry => [entry.reason, entry.createdAt.getDate()]),
    ).toEqual([
      ['pre-update', 2],
      ['pre-update', 1],
      ['pre-restore', 1],
    ])
  })
})

describe('расписание', () => {
  const settings = { enabled: true, time: '04:00' }
  const longAgo = local('2026-10-01 00:00')

  function due(
    now: string,
    state: BackupState = {},
    extra: { startedAt?: Date, lastScheduledAt?: Date } = {},
  ) {
    return isDue({
      now: local(now),
      settings,
      state,
      startedAt: extra.startedAt ?? longAgo,
      lastScheduledAt: extra.lastScheduledAt,
    })
  }

  it('слот через полночь: до 04:00 — вчерашний, с 04:00 — сегодняшний', () => {
    expect(slotFor(local('2026-10-24 03:59'), '04:00')).toEqual(
      local('2026-10-23 04:00'),
    )
    expect(slotFor(local('2026-10-24 04:00'), '04:00')).toEqual(
      local('2026-10-24 04:00'),
    )
    expect(slotFor(local('2026-10-24 00:10'), '23:30')).toEqual(
      local('2026-10-23 23:30'),
    )
  })

  it('слот наступил — пора; копия слота уже есть — нет; выключено — нет', () => {
    expect(due('2026-10-24 04:00')).toBe(true)
    expect(
      due(
        '2026-10-24 04:01',
        {},
        { lastScheduledAt: local('2026-10-24 04:00') },
      ),
    ).toBe(false)
    expect(
      isDue({
        now: local('2026-10-24 05:00'),
        settings: { ...settings, enabled: false },
        state: {},
        startedAt: longAgo,
      }),
    ).toBe(false)
  })

  it('сервер был выключен в слот — догоняем не раньше 5 минут после старта', () => {
    const startedAt = local('2026-10-24 10:00')

    expect(due('2026-10-24 10:04', {}, { startedAt })).toBe(false)
    expect(due('2026-10-24 10:05', {}, { startedAt })).toBe(true)
    // Старт до слота — копия ровно по расписанию
    expect(
      due('2026-10-24 04:00', {}, { startedAt: local('2026-10-24 03:58') }),
    ).toBe(true)
  })

  it('после ошибки — повтор через час, не больше трёх попыток на слот', () => {
    const slot = local('2026-10-24 04:00').toISOString()
    const failed = (count: number, at: string): BackupState => ({
      lastAttempt: {
        at: local(at).toISOString(),
        slot,
        count,
        error: { kind: 'io', params: {} },
      },
    })

    expect(due('2026-10-24 04:30', failed(1, '2026-10-24 04:00'))).toBe(false)
    expect(due('2026-10-24 05:00', failed(1, '2026-10-24 04:00'))).toBe(true)
    expect(due('2026-10-24 09:00', failed(3, '2026-10-24 06:00'))).toBe(false)
    // Следующий слот — попытки заново
    expect(due('2026-10-25 04:00', failed(3, '2026-10-24 06:00'))).toBe(true)
  })

  it('следующая копия для панели', () => {
    expect(
      nextRunAt({
        now: local('2026-10-24 05:00'),
        settings,
        state: {},
        startedAt: longAgo,
        lastScheduledAt: local('2026-10-24 04:00'),
      }),
    ).toEqual(local('2026-10-25 04:00'))
    expect(
      nextRunAt({
        now: local('2026-10-24 10:01'),
        settings,
        state: {},
        startedAt: local('2026-10-24 10:00'),
      }),
    ).toEqual(local('2026-10-24 10:05'))
  })
})
