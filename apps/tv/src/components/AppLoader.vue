<script setup lang="ts">
import { computed, useId } from 'vue'
import { CORD_LENGTH, lampWeight } from '../lib/lamp.ts'

/**
 * Общий лоадер витрины — знак Torsher: шнурок дёргают, торшер щёлкает
 * и светит, дёргают снова — гаснет. Встраивается по месту и ничего
 * не сдвигает: размер задаёт родитель через `size`. Свет — `opacity`,
 * шнурок — `transform`: дёшево на ТВ.
 */
const props = withDefaults(
  defineProps<{
    // Ширина в пикселях макета
    size?: number
    // Подпись под торшером: «Подключаемся к раздаче…»
    label?: string
  }>(),
  { size: 96, label: '' },
)

// Лоадеров на экране бывает несколько: у градиентов свои id, иначе
// url(#…) ссылается на первый экземпляр и ломается, когда тот уходит
const id = useId()
const weight = computed(() => lampWeight(props.size))
</script>

<template>
  <span class="loader" role="status">
    <svg
      class="loader__lamp"
      :style="{ '--loader-size': size }"
      viewBox="-3 -3 30 27"
      aria-hidden="true"
    >
      <defs>
        <radialGradient :id="`${id}-halo`" cx="50%" cy="55%" r="50%">
          <stop offset="0" class="loader__stop--glow" stop-opacity="0.55" />
          <stop offset="0.45" class="loader__stop--light" stop-opacity="0.22" />
          <stop offset="1" class="loader__stop--light" stop-opacity="0" />
        </radialGradient>
        <linearGradient :id="`${id}-beam`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="loader__stop--glow" stop-opacity="0.5" />
          <stop offset="0.6" class="loader__stop--light" stop-opacity="0.12" />
          <stop offset="1" class="loader__stop--light" stop-opacity="0" />
        </linearGradient>
        <radialGradient :id="`${id}-pool`" cx="50%" cy="50%" r="50%">
          <stop offset="0" class="loader__stop--light" stop-opacity="0.45" />
          <stop offset="1" class="loader__stop--light" stop-opacity="0" />
        </radialGradient>
        <linearGradient :id="`${id}-shade`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="loader__stop--glow" />
          <stop offset="1" class="loader__stop--light" />
        </linearGradient>
      </defs>

      <g class="loader__lit">
        <ellipse
          class="loader__halo"
          cx="12"
          cy="7.5"
          rx="11.5"
          ry="9.5"
          :fill="`url(#${id}-halo)`"
        />
        <path d="M4.5 10.5h15L24 21.6H0z" :fill="`url(#${id}-beam)`" />
        <ellipse cx="12" cy="21.4" rx="9" ry="1.4" :fill="`url(#${id}-pool)`" />
      </g>

      <!-- Шнурок под абажуром: кончик прячется за кромку и не ложится на горящий абажур -->
      <g :transform="`translate(17 ${weight.anchorY})`">
        <g class="loader__swing">
          <line
            class="loader__string"
            x1="0"
            y1="0"
            x2="0"
            :y2="CORD_LENGTH"
            stroke="currentColor"
            :stroke-width="weight.cord"
            stroke-linecap="round"
          />
          <circle
            class="loader__bead"
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
        class="loader__lit loader__shade"
        d="M7.5 3h9l3 7.5h-15z"
        :fill="`url(#${id}-shade)`"
        :stroke-width="weight.line"
        stroke-linejoin="round"
      />
    </svg>
    <span v-if="label" class="loader__label">{{ label }}</span>
  </span>
</template>

<style scoped>
/* Место занято сразу, а видно лоадер становится через --loader-delay. Цикл
   стартует с той же задержкой: первый рывок не теряется на невидимом лоадере */
.loader {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  animation: loader-appear var(--motion-fast) var(--motion-easing) var(--loader-delay) forwards;
}

/* Знак 30×27 единиц: высота — 0.9 ширины (aspect-ratio в Chromium 68 нет) */
.loader__lamp {
  display: block;
  width: calc(var(--u) * var(--loader-size));
  height: calc(var(--u) * var(--loader-size) * 0.9);
  overflow: visible;
}

.loader__stop--glow {
  stop-color: var(--color-glow);
}

.loader__stop--light {
  stop-color: var(--color-accent);
}

.loader__shade {
  stroke: var(--color-accent);
}

.loader__lit {
  opacity: 0;
}

.loader__halo {
  transform-box: fill-box;
  transform-origin: center;
  animation: loader-breathe 2.4s ease-in-out infinite alternate;
}

.loader__lit,
.loader__swing,
.loader__string,
.loader__bead {
  transform-origin: 0 0;
  animation-duration: 4s;
  animation-timing-function: linear;
  animation-delay: var(--loader-delay);
  animation-iteration-count: infinite;
}

.loader__lit {
  animation-name: loader-light;
}

.loader__swing {
  animation-name: loader-swing;
}

.loader__string {
  animation-name: loader-string;
}

.loader__bead {
  animation-name: loader-bead;
}

.loader__label {
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

/* Глобальный reduced motion сжимает длительность до 1 мс, и бесконечный цикл
   мерцал бы: лоадер выключает анимации сам и просто горит */
@media (prefers-reduced-motion: reduce) {
  .loader__lit,
  .loader__halo,
  .loader__swing,
  .loader__string,
  .loader__bead {
    animation: none !important;
  }

  .loader__lit {
    opacity: 1;
  }
}

@keyframes loader-appear {
  to {
    opacity: 1;
  }
}

/* Рывки — к 12 % и 62 % цикла, свет переключается в нижней точке рывка */
@keyframes loader-light {
  0%,
  12.9% {
    opacity: 0;
  }

  13%,
  61.9% {
    opacity: 1;
  }

  62%,
  100% {
    opacity: 0;
  }
}

/* Ход бусины 2.4 единицы, отпущенная подпрыгивает */
@keyframes loader-bead {
  0%,
  8% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
  }

  12%,
  14% {
    transform: translateY(2.4px);
    animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }

  17% {
    transform: translateY(-0.5px);
  }

  20% {
    transform: translateY(0.2px);
  }

  23%,
  58% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
  }

  62%,
  64% {
    transform: translateY(2.4px);
    animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }

  67% {
    transform: translateY(-0.5px);
  }

  70% {
    transform: translateY(0.2px);
  }

  73%,
  100% {
    transform: translateY(0);
  }
}

/* Нитка тянется ровно на ход бусины: (3.2 + 2.4) / 3.2 */
@keyframes loader-string {
  0%,
  8% {
    transform: scaleY(1);
    animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
  }

  12%,
  14% {
    transform: scaleY(1.75);
    animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }

  17% {
    transform: scaleY(0.844);
  }

  20% {
    transform: scaleY(1.062);
  }

  23%,
  58% {
    transform: scaleY(1);
    animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
  }

  62%,
  64% {
    transform: scaleY(1.75);
    animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }

  67% {
    transform: scaleY(0.844);
  }

  70% {
    transform: scaleY(1.062);
  }

  73%,
  100% {
    transform: scaleY(1);
  }
}

/* Отпущенный шнурок качается с затуханием */
@keyframes loader-swing {
  0%,
  16% {
    transform: rotate(0);
    animation-timing-function: ease-out;
  }

  20% {
    transform: rotate(10deg);
    animation-timing-function: ease-in-out;
  }

  25% {
    transform: rotate(-6.5deg);
    animation-timing-function: ease-in-out;
  }

  30% {
    transform: rotate(3.8deg);
    animation-timing-function: ease-in-out;
  }

  36% {
    transform: rotate(-2deg);
    animation-timing-function: ease-in-out;
  }

  42% {
    transform: rotate(0.8deg);
    animation-timing-function: ease-in-out;
  }

  48%,
  66% {
    transform: rotate(0);
    animation-timing-function: ease-out;
  }

  70% {
    transform: rotate(10deg);
    animation-timing-function: ease-in-out;
  }

  75% {
    transform: rotate(-6.5deg);
    animation-timing-function: ease-in-out;
  }

  80% {
    transform: rotate(3.8deg);
    animation-timing-function: ease-in-out;
  }

  86% {
    transform: rotate(-2deg);
    animation-timing-function: ease-in-out;
  }

  92% {
    transform: rotate(0.8deg);
    animation-timing-function: ease-in-out;
  }

  98%,
  100% {
    transform: rotate(0);
  }
}

@keyframes loader-breathe {
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
