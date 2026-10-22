<script setup lang="ts">
import type { LampMode, MothPath } from '../../lib/lamp.ts'
import type { StageStep } from '../../lib/player.ts'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import {
  CLICK_PULL,
  CORD_LENGTH,
  createCord,
  lampMode,
  lampWeight,
  mothOrbit,
  mothPath,
  stepCord,
  swarmChange,
  tugCord,
  tugsBetween,
  WAIT_PERIOD,
  waitGlow,
} from '../../lib/lamp.ts'

/**
 * Торшер сцены подготовки плеера. Пока пиров нет, шнурок дёргают всё
 * настойчивее, а свет не загорается; пошли данные — рывок зажигает свет,
 * и к нему слетаются мотыльки, по одному на подключённого пира.
 *
 * Движение считается покадрово (шнурок на пружине, траектории мотыльков),
 * поэтому кадр меняет атрибуты SVG напрямую, без перерисовки Vue.
 */
const props = withDefaults(
  defineProps<{
    step: StageStep
    connected: number
    // Ширина в пикселях макета
    size?: number
  }>(),
  { size: 200 },
)

const id = useId()
const weight = computed(() => lampWeight(props.size))

const lit = ref<SVGGElement>()
const shade = ref<SVGPathElement>()
const swing = ref<SVGGElement>()
const string = ref<SVGLineElement>()
const bead = ref<SVGCircleElement>()
const swarm = ref<SVGGElement>()

const SVG_NS = 'http://www.w3.org/2000/svg'

// Пауза между прилётами мотыльков, с
const SPAWN_GAP = 0.25
// Прилёт на траекторию и отлёт за край, с
const ARRIVE = 1.6
const LEAVE = 1.4

interface Moth {
  el: SVGGElement
  path: MothPath
  state: 'arriving' | 'circling' | 'leaving'
  since: number
  fromX: number
  fromY: number
  x: number
  y: number
  dirX: number
  dirY: number
}

const cord = createCord()
const moths: Moth[] = []
let mode: LampMode | null = null
let isLit = false
// Свет переключается в нижней точке рывка, а не в момент нажатия
let pendingLight: { at: number, on: boolean } | null = null
let waitStart = 0
let waitPrev = -1
let lastTugAt = -10
let nextSpawn = 0
let frame = 0
let lastFrame = 0

function willBeLit() {
  return pendingLight ? pendingLight.on : isLit
}

function click(now: number, on: boolean) {
  tugCord(cord, CLICK_PULL, now)
  pendingLight = { at: now + 0.1, on }
}

function enter(next: LampMode, now: number) {
  mode = next

  if (next === 'peers') {
    if (!willBeLit())
      click(now, true)

    return
  }

  // Свет горел — сначала щелчок выключает его, рывки начинаются после
  waitPrev = -1

  if (willBeLit()) {
    click(now, false)
    waitStart = now + 1.2
  }
  else {
    waitStart = now + 0.4
  }
}

function spawnMoth(now: number) {
  const el = document.createElementNS(SVG_NS, 'g')
  const wings = document.createElementNS(SVG_NS, 'g')

  wings.setAttribute('class', 'lamp-moth__wings')
  // Взмахи вразнобой: свой сдвиг фазы у каждого
  wings.style.animationDelay = `${(-Math.random() * 0.09).toFixed(3)}s`

  for (const cx of [-0.55, 0.55]) {
    const wing = document.createElementNS(SVG_NS, 'ellipse')

    wing.setAttribute('cx', String(cx))
    wing.setAttribute('cy', '0.05')
    wing.setAttribute('rx', '0.62')
    wing.setAttribute('ry', '0.42')
    wings.appendChild(wing)
  }

  const body = document.createElementNS(SVG_NS, 'ellipse')

  body.setAttribute('class', 'lamp-moth__body')
  body.setAttribute('cy', '0.1')
  body.setAttribute('rx', '0.17')
  body.setAttribute('ry', '0.45')
  el.appendChild(wings)
  el.appendChild(body)
  swarm.value?.appendChild(el)

  // Прилетает из-за края кадра с любой стороны
  const angle = Math.random() * Math.PI * 2
  const fromX = 12 + Math.cos(angle) * 26
  const fromY = 8 + Math.sin(angle) * 20

  moths.push({
    el,
    path: mothPath(Math.random),
    state: 'arriving',
    since: now,
    fromX,
    fromY,
    x: fromX,
    y: fromY,
    dirX: 0,
    dirY: 0,
  })
}

function releaseMoth(now: number) {
  const moth = [...moths].reverse().find(item => item.state !== 'leaving')

  if (!moth)
    return

  const dx = moth.x - 12
  const dy = moth.y - 8
  const length = Math.sqrt(dx * dx + dy * dy) || 1

  moth.state = 'leaving'
  moth.since = now
  moth.dirX = dx / length
  moth.dirY = dy / length - 0.3
}

function updateSwarm(dt: number, now: number) {
  const target = mode === 'peers' && isLit ? props.connected : 0
  const active = moths.filter(moth => moth.state !== 'leaving').length
  const change = swarmChange(active, target)

  if (change > 0 && now >= nextSpawn) {
    spawnMoth(now)
    nextSpawn = now + SPAWN_GAP
  }
  else if (change < 0) {
    releaseMoth(now)
  }

  for (let i = moths.length - 1; i >= 0; i--) {
    const moth = moths[i]!
    const age = now - moth.since
    let x: number
    let y: number

    if (moth.state === 'arriving') {
      const k = Math.min(1, age / ARRIVE)
      const eased = 1 - (1 - k) ** 3
      const [ox, oy] = mothOrbit(moth.path, now)

      x = moth.fromX + (ox - moth.fromX) * eased
      y = moth.fromY + (oy - moth.fromY) * eased

      if (k >= 1)
        moth.state = 'circling'
    }
    else if (moth.state === 'circling') {
      [x, y] = mothOrbit(moth.path, now)
    }
    else {
      if (age > LEAVE) {
        moth.el.remove()
        moths.splice(i, 1)
        continue
      }

      const speed = 4 + age * 26

      x = moth.x + moth.dirX * speed * dt
      y = moth.y + moth.dirY * speed * dt
    }

    // Наклон по ходу полёта
    const tilt
      = dt > 0 ? Math.max(-40, Math.min(40, ((x - moth.x) / dt) * 4)) : 0

    moth.x = x
    moth.y = y
    moth.el.setAttribute(
      'transform',
      `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${tilt.toFixed(1)}) scale(1.9)`,
    )
  }
}

function light(now: number) {
  if (isLit)
    return 1

  if (mode !== 'noPeers' || now < waitStart)
    return 0

  return waitGlow((now - waitStart) % WAIT_PERIOD, now - lastTugAt - 0.1, now)
}

function render(now: number) {
  const pull = Math.max(-1.2, Math.min(4, cord.pull))
  const opacity = light(now).toFixed(3)

  bead.value?.setAttribute('transform', `translate(0 ${pull.toFixed(3)})`)
  string.value?.setAttribute(
    'transform',
    `scale(1 ${((CORD_LENGTH + pull) / CORD_LENGTH).toFixed(3)})`,
  )
  swing.value?.setAttribute('transform', `rotate(${cord.swing.toFixed(2)})`)

  if (lit.value)
    lit.value.style.opacity = opacity

  if (shade.value)
    shade.value.style.opacity = opacity
}

function update(dt: number, now: number) {
  const next = lampMode(props.step)

  if (next !== mode)
    enter(next, now)

  if (pendingLight && now >= pendingLight.at) {
    isLit = pendingLight.on
    pendingLight = null
  }

  if (mode === 'noPeers' && now >= waitStart) {
    const t = (now - waitStart) % WAIT_PERIOD

    for (const pull of tugsBetween(waitPrev, t)) {
      tugCord(cord, pull, now)
      lastTugAt = now
    }

    waitPrev = t
  }

  updateSwarm(dt, now)
  stepCord(cord, dt, now)
  render(now)
}

function tick(timestamp: number) {
  const now = timestamp / 1000
  // После паузы вкладки кадр не прыгает: шаг не длиннее 50 мс
  const dt = lastFrame ? Math.min(0.05, now - lastFrame) : 0.016

  lastFrame = now
  update(dt, now)
  frame = requestAnimationFrame(tick)
}

// Без анимации торшер просто горит, если данные идут, и стоит выключенным, если нет
function still() {
  const opacity = lampMode(props.step) === 'peers' ? '1' : '0'

  if (lit.value)
    lit.value.style.opacity = opacity

  if (shade.value)
    shade.value.style.opacity = opacity
}

const reducedMotion
  = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

watch(
  () => props.step,
  () => {
    if (reducedMotion)
      still()
  },
)

onMounted(() => {
  if (reducedMotion)
    still()
  else frame = requestAnimationFrame(tick)
})

onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <svg
    class="lamp"
    :style="{ '--lamp-size': size }"
    viewBox="-3 -3 30 27"
    aria-hidden="true"
  >
    <defs>
      <radialGradient :id="`${id}-halo`" cx="50%" cy="55%" r="50%">
        <stop offset="0" class="lamp__stop--glow" stop-opacity="0.55" />
        <stop offset="0.45" class="lamp__stop--light" stop-opacity="0.22" />
        <stop offset="1" class="lamp__stop--light" stop-opacity="0" />
      </radialGradient>
      <linearGradient :id="`${id}-beam`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="lamp__stop--glow" stop-opacity="0.5" />
        <stop offset="0.6" class="lamp__stop--light" stop-opacity="0.12" />
        <stop offset="1" class="lamp__stop--light" stop-opacity="0" />
      </linearGradient>
      <radialGradient :id="`${id}-pool`" cx="50%" cy="50%" r="50%">
        <stop offset="0" class="lamp__stop--light" stop-opacity="0.45" />
        <stop offset="1" class="lamp__stop--light" stop-opacity="0" />
      </radialGradient>
      <linearGradient :id="`${id}-shade`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="lamp__stop--glow" />
        <stop offset="1" class="lamp__stop--light" />
      </linearGradient>
    </defs>

    <g ref="lit" class="lamp__lit">
      <ellipse
        class="lamp__halo"
        cx="12"
        cy="7.5"
        rx="11.5"
        ry="9.5"
        :fill="`url(#${id}-halo)`"
      />
      <path d="M4.5 10.5h15L24 21.6H0z" :fill="`url(#${id}-beam)`" />
      <ellipse cx="12" cy="21.4" rx="9" ry="1.4" :fill="`url(#${id}-pool)`" />
    </g>

    <g :transform="`translate(17 ${weight.anchorY})`">
      <g ref="swing">
        <line
          ref="string"
          x1="0"
          y1="0"
          x2="0"
          :y2="CORD_LENGTH"
          stroke="currentColor"
          :stroke-width="weight.cord"
          stroke-linecap="round"
        />
        <circle
          ref="bead"
          cx="0"
          :cy="CORD_LENGTH + 0.9"
          :r="weight.bead"
          fill="currentColor"
        />
      </g>
    </g>

    <g
      fill="none"
      stroke="currentColor"
      :stroke-width="weight.line"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M7.5 3h9l3 7.5h-15z" />
      <path d="M12 10.5V21M8 21h8" />
    </g>
    <path
      ref="shade"
      class="lamp__lit lamp__shade"
      d="M7.5 3h9l3 7.5h-15z"
      :fill="`url(#${id}-shade)`"
      :stroke-width="weight.line"
      stroke-linejoin="round"
    />

    <g ref="swarm" />
  </svg>
</template>

<style scoped>
/* Знак 30×27 единиц: высота — 0.9 ширины (aspect-ratio в Chromium 68 нет).
   Как и AppLoader, виден через --loader-delay: быстрый старт им не мелькает */
.lamp {
  display: block;
  width: calc(var(--u) * var(--lamp-size));
  height: calc(var(--u) * var(--lamp-size) * 0.9);
  overflow: visible;
  opacity: 0;
  animation: lamp-appear var(--motion-fast) var(--motion-easing) var(--loader-delay) forwards;
}

.lamp__stop--glow {
  stop-color: var(--color-glow);
}

.lamp__stop--light {
  stop-color: var(--color-accent);
}

.lamp__lit {
  opacity: 0;
}

.lamp__shade {
  stroke: var(--color-accent);
}

.lamp__halo {
  transform-box: fill-box;
  transform-origin: center;
  animation: lamp-breathe 2.4s ease-in-out infinite alternate;
}

/* Мотыльков создаёт кадр, scoped-атрибута у них нет */
.lamp :deep(.lamp-moth__wings) {
  transform-origin: 0 0;
  animation: lamp-flap 90ms ease-in-out infinite alternate;
}

.lamp :deep(.lamp-moth__wings ellipse) {
  fill: var(--color-text);
  opacity: 0.75;
}

.lamp :deep(.lamp-moth__body) {
  fill: var(--color-text);
}

@media (prefers-reduced-motion: reduce) {
  .lamp__halo {
    animation: none !important;
  }
}

@keyframes lamp-appear {
  to {
    opacity: 1;
  }
}

@keyframes lamp-breathe {
  from {
    opacity: 0.82;
    transform: scale(0.94);
  }

  to {
    opacity: 1;
    transform: scale(1.04);
  }
}

@keyframes lamp-flap {
  from {
    transform: scaleX(1);
  }

  to {
    transform: scaleX(0.3);
  }
}
</style>
