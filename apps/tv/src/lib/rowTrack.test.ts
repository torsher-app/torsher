import type { TrackMetrics } from './rowTrack.ts'
import { describe, expect, it } from 'vitest'
import {
  ensureVisible,
  maxOffset,
  offsetOnFocus,
  pageOffset,
  renderWindow,
  revealOffset,
} from './rowTrack.ts'

// 20 карточек по 240 с шагом 268, видно 1000 px
const metrics: TrackMetrics = {
  step: 268,
  itemWidth: 240,
  count: 20,
  viewWidth: 1000,
}

describe('maxOffset', () => {
  it('упор: последняя карточка у правого края', () => {
    expect(maxOffset(metrics)).toBe(19 * 268 + 240 - 1000)
  })

  it('короткий ряд не двигается', () => {
    expect(maxOffset({ ...metrics, count: 3 })).toBe(0)
  })
})

describe('ensureVisible', () => {
  it('видимую карточку не трогает', () => {
    expect(ensureVisible(268, 3, metrics)).toBe(268)
  })

  it('карточку слева за краем ставит к левому краю', () => {
    expect(ensureVisible(1000, 2, metrics)).toBe(536)
  })

  it('карточку справа за краем — к правому краю', () => {
    expect(ensureVisible(0, 5, metrics)).toBe(5 * 268 + 240 - 1000)
  })
})

describe('offsetOnFocus', () => {
  it('наведение не двигает ряд', () => {
    expect(offsetOnFocus(268, 7, 'pointer', metrics, 6)).toBe(268)
  })

  it('колесо не листает ряд', () => {
    expect(offsetOnFocus(0, 5, 'wheel', metrics)).toBe(0)
  })

  it('шаг пульта с левого края: фокус остаётся у левого края', () => {
    expect(offsetOnFocus(0, 1, 'nav', metrics, 0)).toBe(268)
    expect(offsetOnFocus(268, 2, 'nav', metrics, 1)).toBe(536)
  })

  it('шаг пульта из середины: рамка на месте, лента сдвигается под ней', () => {
    // Фокус на третьей видимой карточке, ряд в начале
    expect(offsetOnFocus(0, 3, 'nav', metrics, 2)).toBe(268)
  })

  it('влево в начале ряда фокус уходит влево, ряд не уезжает за начало', () => {
    expect(offsetOnFocus(0, 1, 'nav', metrics, 2)).toBe(0)
  })

  it('у конца ряда упор', () => {
    const max = maxOffset(metrics)

    expect(offsetOnFocus(max, 19, 'nav', metrics, 18)).toBe(max)
  })

  it('вход в ряд пультом не двигает ряд, если карточка видна', () => {
    expect(offsetOnFocus(536, 4, 'nav', metrics)).toBe(536)
  })

  it('вход на невидимую карточку подтягивает её в окно', () => {
    expect(offsetOnFocus(0, 9, 'nav', metrics)).toBe(9 * 268 + 240 - 1000)
  })
})

describe('pageOffset', () => {
  it('листает на 80% видимой ширины', () => {
    expect(pageOffset(0, 1, metrics)).toBe(800)
    expect(pageOffset(1000, -1, metrics)).toBe(200)
  })

  it('не выходит за начало и упор', () => {
    expect(pageOffset(100, -1, metrics)).toBe(0)
    expect(pageOffset(maxOffset(metrics) - 10, 1, metrics)).toBe(
      maxOffset(metrics),
    )
  })
})

describe('renderWindow', () => {
  it('до замера рисует первые карточки', () => {
    expect(renderWindow(0, { ...metrics, step: 0 })).toEqual({
      start: 0,
      end: 10,
    })
  })

  it('держит одну карточку слева и два экрана справа', () => {
    // Первая видимая — 5-я, на экран помещается 4
    expect(renderWindow(5 * 268, metrics)).toEqual({ start: 4, end: 13 })
  })

  it('не выходит за границы ряда', () => {
    expect(renderWindow(0, metrics)).toEqual({ start: 0, end: 8 })
    expect(renderWindow(maxOffset(metrics), metrics).end).toBe(20)
  })
})

describe('revealOffset', () => {
  it('не двигает ленту, пока элемент в окне', () => {
    expect(revealOffset(0, { left: 300, width: 100 }, 1000, 3000, 20)).toBe(0)
  })

  it('подтягивает элемент за правым краем с запасом', () => {
    expect(revealOffset(0, { left: 1000, width: 100 }, 1000, 3000, 20)).toBe(
      120,
    )
  })

  it('возвращает элемент слева и не уходит за начало', () => {
    expect(revealOffset(500, { left: 400, width: 100 }, 1000, 3000, 20)).toBe(
      380,
    )
    expect(revealOffset(500, { left: 10, width: 100 }, 1000, 3000, 20)).toBe(0)
  })

  it('упирается в конец ленты', () => {
    expect(revealOffset(0, { left: 2950, width: 50 }, 1000, 3000, 20)).toBe(
      2000,
    )
  })

  it('короткая лента не едет', () => {
    expect(revealOffset(0, { left: 600, width: 100 }, 1000, 700, 20)).toBe(0)
  })
})
