import type { StageStep } from './player.ts'

/**
 * Торшер — знак Torsher в роли лоадера. Координаты — сетка знака 24×24
 * (viewBox лоадера шире: свет выходит за знак).
 */

export interface LampWeight {
  line: number
  cord: number
  bead: number
  /** Где шнурок крепится к абажуру по вертикали */
  anchorY: number
}

/**
 * Толщина линий по размеру в пикселях макета: знак нарисован с линией 2 под
 * иконку, и крупный торшер с ней тяжелеет. Шнурок и бусина тоньше вместе с абажуром.
 */
export function lampWeight(size: number): LampWeight {
  const [line, cord, bead]
    = size > 144
      ? [1.3, 0.75, 0.9]
      : size > 48
        ? [1.6, 0.85, 0.95]
        : [2, 1, 1.05]

  // Нижний край абажура — y 10.5; шнурок висит от края его линии
  return { line, cord, bead, anchorY: 10.4 + line / 2 }
}

/** Длина шнурка от абажура до бусины */
export const CORD_LENGTH = 3.2

/** Обычный рывок: свет переключается в нижней точке */
export const CLICK_PULL = 2.4

// Столько держат шнурок внизу, потом отпускают
const TUG_HOLD = 0.14

/**
 * Шнурок на пружине: `pull` — насколько оттянута бусина, `swing` — угол
 * качания в градусах. Отпущенный шнурок подпрыгивает и качается с затуханием.
 */
export interface Cord {
  pull: number
  velocity: number
  target: number
  held: boolean
  releaseAt: number
  swing: number
  swingVelocity: number
}

export function createCord(): Cord {
  return {
    pull: 0,
    velocity: 0,
    target: 0,
    held: false,
    releaseAt: 0,
    swing: 0,
    swingVelocity: 0,
  }
}

export function tugCord(cord: Cord, amount: number, now: number) {
  cord.target = amount
  cord.held = true
  cord.releaseAt = now + TUG_HOLD
}

function releaseCord(cord: Cord) {
  // Чем сильнее оттянули, тем шире качнётся
  cord.swingVelocity += 38 * cord.pull
  cord.target = 0
  cord.held = false
  cord.releaseAt = 0
}

export function stepCord(cord: Cord, dt: number, now: number) {
  if (cord.releaseAt && now >= cord.releaseAt)
    releaseCord(cord)

  // Пружина жёсткая: три подшага держат расчёт устойчивым при dt до 50 мс
  const steps = 3
  const h = dt / steps

  for (let i = 0; i < steps; i++) {
    const stiffness = cord.held ? 260 : 180
    const damping = cord.held ? 22 : 9

    cord.velocity
      += (stiffness * (cord.target - cord.pull) - damping * cord.velocity) * h
    cord.pull += cord.velocity * h
    cord.swingVelocity += (-60 * cord.swing - 2.2 * cord.swingVelocity) * h
    cord.swing += cord.swingVelocity * h
  }
}

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
