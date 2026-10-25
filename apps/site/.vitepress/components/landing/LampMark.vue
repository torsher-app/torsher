<script setup lang="ts">
import {
  CLICK_PULL,
  CORD_LENGTH,
  createCord,
  lampWeight,
  stepCord,
  tugCord,
} from '@torsher/tokens/lamp'
import { onBeforeUnmount, ref, useId, watch } from 'vue'

/**
 * The Torsher lamp, drawn and pulled like the showcase loader: a change of
 * `lit` tugs the cord on its spring, and the light switches at the bottom of
 * the pull. Unlit, only the outline is drawn. A click pulls the cord too.
 */
const props = withDefaults(
  defineProps<{
    lit?: boolean
    // Width in px, for the line weight
    size?: number
  }>(),
  { lit: true, size: 120 },
)

const emit = defineEmits<{ 'update:lit': [lit: boolean] }>()

// Gradient ids must be unique: the lamp appears twice on the page
const id = useId()
const weight = lampWeight(props.size)
const lightOn = ref(props.lit)

const swing = ref<SVGGElement>()
const string = ref<SVGLineElement>()
const bead = ref<SVGCircleElement>()

// The light switches at the bottom of the pull, not when it starts
const LIGHT_AFTER = 0.1
// The cord swings out within this time
const SETTLE = 2.5

let frame = 0

function render(pull: number, angle: number) {
  const clamped = Math.max(-1.2, Math.min(4, pull))

  bead.value?.setAttribute('transform', `translate(0 ${clamped.toFixed(3)})`)
  string.value?.setAttribute(
    'transform',
    `scale(1 ${((CORD_LENGTH + clamped) / CORD_LENGTH).toFixed(3)})`,
  )
  swing.value?.setAttribute('transform', `rotate(${angle.toFixed(2)})`)
}

function pull(on: boolean) {
  cancelAnimationFrame(frame)

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    lightOn.value = on
    return
  }

  const cord = createCord()
  let start = 0
  let last = 0

  const tick = (timestamp: number) => {
    const now = timestamp / 1000

    if (!start) {
      start = now
      tugCord(cord, CLICK_PULL, now)
    }

    stepCord(cord, last ? Math.min(0.05, now - last) : 0.016, now)
    last = now
    render(cord.pull, cord.swing)

    if (lightOn.value !== on && now - start >= LIGHT_AFTER)
      lightOn.value = on

    if (now - start < SETTLE)
      frame = requestAnimationFrame(tick)
    else render(0, 0)
  }

  frame = requestAnimationFrame(tick)
}

watch(() => props.lit, pull)

onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <button
    type="button"
    class="switch"
    :aria-label="lit ? 'Switch the light off' : 'Switch the light on'"
    @click="emit('update:lit', !lit)"
  >
    <svg
      viewBox="-3 -3 30 27"
      aria-hidden="true"
      class="lamp"
      :class="{ on: lightOn }"
    >
      <defs>
        <radialGradient :id="`${id}-halo`" cx="50%" cy="55%" r="50%">
          <stop offset="0" class="stop-glow" stop-opacity="0.55" />
          <stop offset="0.45" class="stop-light" stop-opacity="0.22" />
          <stop offset="1" class="stop-light" stop-opacity="0" />
        </radialGradient>
        <linearGradient :id="`${id}-beam`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="stop-glow" stop-opacity="0.5" />
          <stop offset="0.6" class="stop-light" stop-opacity="0.12" />
          <stop offset="1" class="stop-light" stop-opacity="0" />
        </linearGradient>
        <radialGradient :id="`${id}-pool`" cx="50%" cy="50%" r="50%">
          <stop offset="0" class="stop-light" stop-opacity="0.45" />
          <stop offset="1" class="stop-light" stop-opacity="0" />
        </radialGradient>
        <linearGradient :id="`${id}-shade`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="stop-glow" />
          <stop offset="1" class="stop-light" />
        </linearGradient>
      </defs>

      <g class="lit">
        <ellipse
          class="halo"
          cx="12"
          cy="7.5"
          rx="11.5"
          ry="9.5"
          :fill="`url(#${id}-halo)`"
        />
        <path d="M4.5 10.5h15L24 21.6H0z" :fill="`url(#${id}-beam)`" />
        <ellipse cx="12" cy="21.4" rx="9" ry="1.4" :fill="`url(#${id}-pool)`" />
      </g>

      <!-- The cord hangs under the shade: its top hides behind the shade's edge -->
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
        class="lit shade"
        d="M7.5 3h9l3 7.5h-15z"
        :fill="`url(#${id}-shade)`"
        :stroke-width="weight.line"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</template>

<style scoped>
.switch {
  display: block;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: none;
  cursor: pointer;
}

.switch:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 6px;
}

.lamp {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  color: var(--color-accent);
}

.stop-glow {
  stop-color: var(--color-glow);
}

.stop-light {
  stop-color: var(--color-accent);
}

.shade {
  stroke: var(--color-accent);
}

.lit {
  opacity: 0;
}

.on .lit {
  opacity: 1;
}

@media (prefers-reduced-motion: no-preference) {
  .halo {
    transform-box: fill-box;
    transform-origin: center;
    animation: breathe 2.4s ease-in-out infinite alternate;
  }
}

@keyframes breathe {
  from {
    opacity: 0.82;
    transform: scale(0.94);
  }

  to {
    opacity: 1;
    transform: scale(1.04);
  }
}
</style>
