/**
 * Торшер — знак Torsher, который дёргают за шнурок: в лоадерах витрины и на
 * сайте. Координаты — сетка знака 24×24 (viewBox торшера шире: свет выходит
 * за знак).
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
