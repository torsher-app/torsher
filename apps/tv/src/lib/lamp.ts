import type { StageStep } from './player.ts'

/**
 * Торшер на сцене плеера. Размеры знака и шнурок на пружине общие с сайтом
 * и лежат в `@torsher/tokens/lamp`.
 */
export {
  CLICK_PULL,
  CORD_LENGTH,
  createCord,
  lampWeight,
  stepCord,
  tugCord,
} from '@torsher/tokens/lamp'
export type { Cord, LampWeight } from '@torsher/tokens/lamp'

/**
 * Режим торшера на сцене плеера. Свет значит «данные пошли»: подключение,
 * ожидание пиров и переподключение — одно состояние без света.
 */
export type LampMode = 'noPeers' | 'peers'

export function lampMode(step: StageStep): LampMode {
  return step === 'buffering' || step === 'slow' ? 'peers' : 'noPeers'
}

/**
 * Рывки без пиров по секундам цикла: один, два подряд, три подряд — всё
 * сильнее и чаще. Цикл идёт от начала режима и не сбрасывается при смене шага
 * внутри него: чем дольше нет пиров, тем настойчивее.
 */
export const WAIT_TUGS: readonly (readonly [at: number, pull: number])[] = [
  [0, 1.4],
  [2, 2],
  [2.45, 2],
  [4.4, 2.6],
  [4.75, 2.6],
  [5.1, 2.6],
]
export const WAIT_EMBER_AT = 5.5
export const WAIT_FADE_AT = 10
export const WAIT_PERIOD = 12

// Тление гаснет за столько секунд
const EMBER_FADE = 1.2

/** Рывки, которые пришлись на время цикла `(prev, t]`; `t < prev` — цикл пошёл заново */
export function tugsBetween(prev: number, t: number): number[] {
  if (t < prev)
    return [...tugsBetween(prev, WAIT_PERIOD), ...tugsBetween(-1, t)]

  return WAIT_TUGS.filter(([at]) => prev < at && at <= t).map(
    ([, pull]) => pull,
  )
}

/**
 * Свет без пиров. Рывок — короткий сбой «вспыхнул, провалился, дрогнул»;
 * после третьей серии лампа неровно тлеет, с редкими провалами, как на плохом
 * контакте, и к концу цикла гаснет. `sinceTug` — с нижней точки рывка.
 */
export function waitGlow(
  cycleTime: number,
  sinceTug: number,
  now: number,
): number {
  let light = 0

  if (sinceTug >= 0 && sinceTug < 0.06)
    light = 0.34
  else if (sinceTug >= 0.06 && sinceTug < 0.11)
    light = 0.05
  else if (sinceTug >= 0.11 && sinceTug < 0.17)
    light = 0.2

  if (cycleTime >= WAIT_EMBER_AT) {
    let ember = 0.2 + 0.06 * Math.sin(now * 3) + 0.04 * Math.sin(now * 17)

    if (Math.sin(now * 5.3) > 0.93)
      ember *= 0.25

    if (cycleTime >= WAIT_FADE_AT)
      ember *= Math.max(0, 1 - (cycleTime - WAIT_FADE_AT) / EMBER_FADE)

    light = Math.max(light, ember)
  }

  return light
}

/** Мотыльков у света не больше: дальше рой — каша, а не пиры */
export const MAX_MOTHS = 10

/**
 * Мотыльков столько, сколько подключено пиров. За шаг — по одному, чтобы
 * прилетали и улетали вразнобой: +1 позвать, −1 отпустить.
 */
export function swarmChange(active: number, connected: number): -1 | 0 | 1 {
  const target = Math.min(MAX_MOTHS, Math.max(0, connected))

  if (active < target)
    return 1

  return active > target ? -1 : 0
}

/** Траектория мотылька вокруг абажура — фигура Лиссажу со своим размахом и темпом */
export interface MothPath {
  rx: number
  ry: number
  speedX: number
  speedY: number
  phaseX: number
  phaseY: number
  centerY: number
}

export function mothPath(random: () => number): MothPath {
  const between = (a: number, b: number) => a + random() * (b - a)

  return {
    rx: between(4.5, 9),
    ry: between(2.5, 6),
    speedX: between(0.8, 1.7),
    speedY: between(1.2, 2.3),
    phaseX: between(0, Math.PI * 2),
    phaseY: between(0, Math.PI * 2),
    centerY: between(6, 9),
  }
}

/** Точка на траектории в момент `t`, с мелкой дрожью крыльев */
export function mothOrbit(path: MothPath, t: number): [number, number] {
  return [
    12
    + path.rx * Math.sin(path.speedX * t + path.phaseX)
    + 0.25 * Math.sin(t * 9 + path.phaseY),
    path.centerY
    + path.ry * Math.sin(path.speedY * t + path.phaseY)
    + 0.25 * Math.cos(t * 11 + path.phaseX),
  ]
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Свет, пока идут данные: торшер разгорается по мере набора буфера. Слабее
 * трети не горит — иначе зажжённый рывком свет почти не виден.
 */
export function lampLight(progress: number) {
  return 0.35 + 0.65 * clamp01(progress)
}

/** Темп мотыльков: чем ближе старт, тем живее кружат */
export function mothTempo(progress: number) {
  return 0.7 + 0.6 * clamp01(progress)
}

/**
 * Плавное приближение к цели за кадр: новый ответ статистики не дёргает свет.
 * `tau` — за сколько секунд проходится около двух третей пути.
 */
export function approach(
  current: number,
  target: number,
  dt: number,
  tau = 0.5,
) {
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}
