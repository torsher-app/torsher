import { describe, expect, it } from 'vitest'
import {
  backAction,
  bufferedSeconds,
  bufferingStep,
  byteOffset,
  canDimPause,
  canRetry,
  clampTime,
  countdownOf,
  endedEarly,
  endsAt,
  formatClock,
  formatDuration,
  formatGigabytes,
  freshBudget,
  holdScrub,
  MEDIA_ERROR_WINDOW_MS,
  mediaErrorAction,
  networkState,
  nextRetry,
  pressScrub,
  RETRY_RESET_MS,
  RETRY_WINDOW_MS,
  retryDelay,
  SCRUB_TICK_MS,
  seekStep,
  settleBudget,
  stallAction,
  startErrorAction,
  STATS_STALE_MS,
  streamLive,
  upNextVisible,
  videoTimePolicy,
} from './player.ts'

const peers = (connected: number) => ({ connected, found: connected * 3 })

describe('шаги буферизации', () => {
  it('пока движок ищет пиров — «подключаемся»', () => {
    expect(bufferingStep(null, 0)).toBe('connecting')
    expect(bufferingStep({ activity: 'idle', peers: peers(0) }, 2000)).toBe(
      'connecting',
    )
    expect(
      bufferingStep({ activity: 'downloading', peers: peers(0) }, 5000),
    ).toBe('connecting')
  })

  it('долго без пиров — честное «ждём пиров»', () => {
    expect(
      bufferingStep({ activity: 'downloading', peers: peers(0) }, 15_000),
    ).toBe('waitingPeers')
    expect(bufferingStep(null, 20_000)).toBe('waitingPeers')
  })

  it('пиры подключились — буферизация', () => {
    expect(
      bufferingStep({ activity: 'downloading', peers: peers(4) }, 1000),
    ).toBe('buffering')
    expect(
      bufferingStep({ activity: 'downloading', peers: peers(4) }, 60_000),
    ).toBe('buffering')
  })
})

describe('back в два шага', () => {
  it('сначала закрывает панель дорожек, потом прячет OSD, потом выходит', () => {
    expect(backAction({ panelOpen: true, osdVisible: true })).toBe(
      'closePanel',
    )
    expect(backAction({ panelOpen: false, osdVisible: true })).toBe('hideOsd')
    expect(backAction({ panelOpen: false, osdVisible: false })).toBe('exit')
  })
})

describe('перемотка', () => {
  it('шаг растёт с временем удержания', () => {
    expect(seekStep(0)).toBe(10)
    expect(seekStep(1500)).toBe(30)
    expect(seekStep(4000)).toBe(60)
    expect(seekStep(10_000)).toBe(120)
  })

  it('отдельные нажатия копятся от уже набранной цели', () => {
    const first = pressScrub(null, 100, 1, 0, 5400)
    const second = pressScrub(first, 999, 1, 300, 5400)

    expect(first.target).toBe(110)
    expect(second.target).toBe(120)
  })

  it('смена направления начинает отсчёт удержания заново', () => {
    const forward = pressScrub(null, 100, 1, 0, 5400)
    const back = pressScrub(forward, 100, -1, 5000, 5400)

    expect(back.target).toBe(100)
    expect(back.startedAt).toBe(5000)
  })

  it('при удержании шаг не чаще тика и ускоряется', () => {
    let scrub = pressScrub(null, 0, 1, 0, 5400)

    expect(holdScrub(scrub, SCRUB_TICK_MS - 1, 5400)).toBe(scrub)

    scrub = holdScrub(scrub, 250, 5400)
    expect(scrub.target).toBe(20)

    scrub = holdScrub(scrub, 2000, 5400)
    expect(scrub.target).toBe(50)

    scrub = holdScrub(scrub, 7000, 5400)
    expect(scrub.target).toBe(170)
  })

  it('не уходит за начало и за конец', () => {
    expect(pressScrub(null, 4, -1, 0, 5400).target).toBe(0)
    expect(pressScrub(null, 5395, 1, 0, 5400).target).toBe(5399)
    expect(clampTime(50, Number.NaN)).toBe(50)
  })
})

describe('буфер и позиция в байтах', () => {
  it('секунды буфера по среднему битрейту файла', () => {
    expect(bufferedSeconds(50 * 1024 * 1024, 1024 * 1024 * 1024, 2048)).toBe(
      100,
    )
    expect(bufferedSeconds(1000, 0, 100)).toBe(0)
    expect(bufferedSeconds(1000, 5000, Number.NaN)).toBe(0)
  })

  it('позиция чтения в байтах', () => {
    expect(byteOffset(600, 1_000_000, 6000)).toBe(100_000)
    expect(byteOffset(600, 1_000_000, Number.NaN)).toBe(0)
  })
})

describe('время', () => {
  it('длительность в часах и минутах', () => {
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatDuration(1124)).toBe('18:44')
    expect(formatDuration(-5)).toBe('0:00')
  })

  it('«закончится в» — от текущего времени плюс остаток', () => {
    const now = new Date(2026, 9, 21, 18, 2, 30)

    expect(endsAt(now, 1124).getMinutes()).toBe(21)
    expect(formatClock(endsAt(now, 1124), 'ru_RU')).toBe('18:21')
  })
})

describe('место на диске', () => {
  it('гигабайты с одним знаком по локали', () => {
    expect(formatGigabytes(2.25 * 1024 ** 3, 'ru_RU')).toBe('2,3')
    expect(formatGigabytes(0, 'en_US')).toBe('0.0')
  })
})

describe('networkState', () => {
  // 1 ГБ на 1000 с — битрейт 1 МБ/с
  const base = {
    size: 1e9,
    downloaded: 1e8,
    duration: 1000,
    bufferSeconds: 300,
    remaining: 800,
  }

  it('файл скачан или скачан до конца от позиции — сеть не важна', () => {
    expect(networkState({ ...base, speed: 0, downloaded: 1e9 })).toEqual({
      kind: 'done',
    })
    expect(networkState({ ...base, speed: 0, bufferSeconds: 800 })).toEqual({
      kind: 'done',
    })
  })

  it('палочки — скорость против битрейта', () => {
    const level = (speed: number) => {
      const state = networkState({ ...base, speed })
      return state.kind === 'signal' ? state.level : -1
    }

    expect([0, 0.5e6, 1e6, 1.5e6, 3e6].map(level)).toEqual([0, 1, 2, 3, 4])
  })

  it('тревога — только когда запас кончается и сеть не успевает', () => {
    expect(
      networkState({ ...base, speed: 0, bufferSeconds: 300 }),
    ).toMatchObject({ low: false })
    expect(
      networkState({ ...base, speed: 0.5e6, bufferSeconds: 40 }),
    ).toMatchObject({ low: true })
    expect(
      networkState({ ...base, speed: 2e6, bufferSeconds: 40 }),
    ).toMatchObject({ low: false })
  })
})

describe('mediaErrorAction', () => {
  it('сначала восстанавливает', () => {
    expect(mediaErrorAction([], 10_000)).toBe('recover')
  })

  it('вторая ошибка в окне — смена аудиокодека и восстановление', () => {
    expect(mediaErrorAction([10_000], 12_000)).toBe('swapAndRecover')
  })

  it('третья ошибка в окне — отказ', () => {
    expect(mediaErrorAction([10_000, 11_000], 12_000)).toBe('fail')
  })

  it('ошибки реже окна снова восстанавливаются', () => {
    expect(mediaErrorAction([10_000], 10_000 + MEDIA_ERROR_WINDOW_MS)).toBe(
      'recover',
    )
    expect(
      mediaErrorAction([1000, 5000], 5000 + MEDIA_ERROR_WINDOW_MS + 1),
    ).toBe('recover')
  })
})

describe('videoTimePolicy', () => {
  it('во время просмотра позиция идёт и сохраняется', () => {
    expect(videoTimePolicy({ phase: 'playing', restarting: false })).toEqual({
      track: true,
      save: true,
    })
  })

  it('до первых кадров позиция идёт, но не сохраняется', () => {
    expect(videoTimePolicy({ phase: 'buffering', restarting: false })).toEqual({
      track: true,
      save: false,
    })
  })

  it('перезапуск дорожки: сброс currentTime в 0 не трогает позицию и не сохраняется', () => {
    expect(videoTimePolicy({ phase: 'playing', restarting: true })).toEqual({
      track: false,
      save: false,
    })
  })
})

describe('паузы между повторами', () => {
  it.each([
    [0, 2000],
    [1, 5000],
    [2, 10_000],
    [3, 20_000],
    [4, 30_000],
    [5, 30_000],
    [12, 30_000],
  ])('попытка %i — через %i мс', (attempt, delay) => {
    expect(retryDelay(attempt)).toBe(delay)
  })
})

describe('бюджет повторов', () => {
  it('первый сбой открывает серию, паузы растут', () => {
    const first = nextRetry(freshBudget(), 1000)!

    expect(first).toEqual({
      budget: { firstFailureAt: 1000, attempts: 1 },
      delayMs: 2000,
    })
    expect(nextRetry(first.budget, 5000)).toEqual({
      budget: { firstFailureAt: 1000, attempts: 2 },
      delayMs: 5000,
    })
  })

  it('повторы идут 3 минуты с первого сбоя серии, дальше — ошибка', () => {
    const budget = { firstFailureAt: 0, attempts: 9 }

    expect(canRetry(budget, RETRY_WINDOW_MS - 1)).toBe(true)
    expect(nextRetry(budget, RETRY_WINDOW_MS - 1)?.delayMs).toBe(30_000)
    expect(canRetry(budget, RETRY_WINDOW_MS)).toBe(false)
    expect(nextRetry(budget, RETRY_WINDOW_MS)).toBeNull()
    expect(canRetry(freshBudget(), 10 * RETRY_WINDOW_MS)).toBe(true)
  })

  it('минута воспроизведения без остановки сбрасывает серию', () => {
    const budget = { firstFailureAt: 0, attempts: 3 }

    expect(settleBudget(budget, 1000, 1000 + RETRY_RESET_MS)).toEqual(
      freshBudget(),
    )
    expect(settleBudget(budget, 1000, RETRY_RESET_MS)).toBe(budget)
    expect(settleBudget(budget, null, 10 * RETRY_RESET_MS)).toBe(budget)
  })

  it('сбои подряд без действий зрителя исчерпывают окно за 3 минуты', () => {
    let budget = freshBudget()
    let at = 1000
    let attempts = 0

    for (;;) {
      const next = nextRetry(budget, at)

      if (!next)
        break

      budget = next.budget
      attempts++
      at += next.delayMs
    }

    expect(budget.firstFailureAt).toBe(1000)
    expect(at - 1000).toBeGreaterThanOrEqual(RETRY_WINDOW_MS)
    expect(at - 1000).toBeLessThan(RETRY_WINDOW_MS + 30_000)
    expect(attempts).toBe(budget.attempts)
  })
})

describe('streamLive', () => {
  it('пауза и «играть» зрителя считаются только на идущем потоке', () => {
    const live = {
      phase: 'playing',
      restarting: false,
      failed: false,
    } as const

    expect(streamLive(live)).toBe(true)
    expect(streamLive({ ...live, restarting: true })).toBe(false)
    expect(streamLive({ ...live, failed: true })).toBe(false)
    expect(streamLive({ ...live, phase: 'buffering' })).toBe(false)
    expect(streamLive({ ...live, phase: 'starting' })).toBe(false)
  })
})

describe('сторож прогресса', () => {
  const base = {
    now: 100_000,
    statsAt: 99_000,
    peers: 5,
    aheadSeconds: 0,
    stuckMs: 0,
    peersMs: 200_000,
    budgetLeft: true,
  }

  it.each([
    ['видео идёт', {}, 'ok'],
    ['стоит недолго при пирах', { stuckMs: 30_000 }, 'wait'],
    [
      'статистика молчит дольше 15 с, видео идёт',
      { statsAt: base.now - STATS_STALE_MS - 1 },
      'ok',
    ],
    [
      'статистика молчит, видео стоит меньше 20 с',
      { statsAt: base.now - STATS_STALE_MS - 1, stuckMs: 19_000 },
      'wait',
    ],
    [
      'статистика молчит, видео стоит 20 с',
      { statsAt: base.now - STATS_STALE_MS - 1, stuckMs: 20_000 },
      'retry',
    ],
    [
      'статистика молчит ровно 15 с, видео стоит 20 с при пирах',
      { statsAt: base.now - STATS_STALE_MS, stuckMs: 20_000 },
      'wait',
    ],
    [
      'статистика молчит ровно 15 с',
      { statsAt: base.now - STATS_STALE_MS },
      'ok',
    ],
    ['пиров нет — ждём без лимита', { peers: 0, stuckMs: 600_000 }, 'wait'],
    ['статистики ещё не было', { peers: null, stuckMs: 60_000 }, 'wait'],
    [
      'данные впереди, видео стоит 20 с',
      { aheadSeconds: 30, stuckMs: 20_000 },
      'retry',
    ],
    [
      'данные впереди и без пиров: файл скачан, стоит конвейер',
      { peers: 0, aheadSeconds: 45, stuckMs: 20_000 },
      'retry',
    ],
    [
      'данные впереди, видео стоит меньше 20 с',
      { aheadSeconds: 30, stuckMs: 19_000 },
      'wait',
    ],
    ['данных впереди мало', { aheadSeconds: 29, stuckMs: 60_000 }, 'wait'],
    ['пиры есть, стоит 2 минуты', { stuckMs: 120_000 }, 'retry'],
    [
      'пиры есть, стоит 2 минуты, повторы кончились',
      { stuckMs: 120_000, budgetLeft: false },
      'slow',
    ],
    [
      'пиры подключились недавно после простоя',
      { stuckMs: 300_000, peersMs: 30_000 },
      'wait',
    ],
  ] as const)('%s → %s', (_, change, action) => {
    expect(stallAction({ ...base, ...change })).toBe(action)
  })
})

describe('ранний конец файла', () => {
  it.each([
    ['конец файла', 100, 100, 100, false],
    ['за 2 с до конца', 98, 100, 100, false],
    ['обрыв посреди файла', 50, 100, 100, true],
    ['длительность уточнилась у видео', 98, 200, 100, true],
    ['видео не знает длительность — по сессии', 50, Number.NaN, 100, true],
    ['поток без длительности', 50, Infinity, Number.NaN, false],
    ['длительности нет совсем', 50, Number.NaN, Number.NaN, false],
  ] as const)('%s', (_, time, media, known, early) => {
    expect(endedEarly(time, media, known)).toBe(early)
  })
})

describe('сбой запуска', () => {
  it.each([
    [{ status: 502 }, 'retry'],
    [{ status: 503, engineKind: 'starting' }, 'retry'],
    [{ status: 503, engineKind: 'stopped' }, 'retry'],
    [{ status: 503 }, 'retry'],
    [{ status: 503, engineKind: 'not_installed' }, 'fail'],
    [{ status: 504 }, 'retry'],
    [{ status: undefined, name: 'TypeError' }, 'retry'],
    [{ status: undefined, name: 'TimeoutError' }, 'retry'],
    [{ status: 401 }, 'fail'],
    [{ status: 404 }, 'fail'],
    [{ status: 409 }, 'fail'],
    [{ status: 507 }, 'fail'],
    [{ status: 500 }, 'fail'],
    [{ status: undefined, name: 'SyntaxError' }, 'fail'],
    [{ status: undefined }, 'fail'],
  ] as const)('%o → %s', (error, action) => {
    expect(startErrorAction(error)).toBe(action)
  })
})

describe('canDimPause', () => {
  const pause = {
    phase: 'playing',
    paused: true,
    restarting: false,
    panelOpen: false,
    error: false,
  }

  it('затемняет только паузу зрителя', () => {
    expect(canDimPause(pause)).toBe(true)
    expect(canDimPause({ ...pause, paused: false })).toBe(false)
    expect(canDimPause({ ...pause, phase: 'buffering' })).toBe(false)
  })

  it('не затемняет перезапуск, открытую панель и ошибку', () => {
    expect(canDimPause({ ...pause, restarting: true })).toBe(false)
    expect(canDimPause({ ...pause, panelOpen: true })).toBe(false)
    expect(canDimPause({ ...pause, error: true })).toBe(false)
  })
})

describe('следующая серия', () => {
  const base = { available: true, dismissed: false, ended: false }

  it('за 30 с до конца и в конце, если не отменили', () => {
    expect(upNextVisible({ ...base, remaining: 31 })).toBe(false)
    expect(upNextVisible({ ...base, remaining: 30 })).toBe(true)
    expect(upNextVisible({ ...base, remaining: 600, ended: true })).toBe(true)
    expect(upNextVisible({ ...base, remaining: 10, dismissed: true })).toBe(
      false,
    )
    expect(upNextVisible({ ...base, remaining: 10, available: false })).toBe(
      false,
    )
    expect(upNextVisible({ ...base, remaining: Number.NaN })).toBe(false)
  })

  it('отсчёт — остаток целыми вверх', () => {
    expect(countdownOf(12.2)).toBe(13)
    expect(countdownOf(-1)).toBe(0)
    expect(countdownOf(Number.NaN)).toBe(0)
  })
})
