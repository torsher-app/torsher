<script setup lang="ts">
import type { TorrentStats } from '@torsher/api-client'
import type { StageStep } from '../../lib/player.ts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMegabits } from '../../lib/player.ts'
import AppIcon from '../AppIcon.vue'

// Статус под торшером сцены подготовки (`PlayerStage`): шаг и под ним подробности
const props = defineProps<{
  step: StageStep
  stats: TorrentStats | undefined
  /** Доля подготовки 0–1 — та же, что у света торшера */
  progress?: number
  /** Своя подпись шага: экран подготовки ищет серию до потока */
  label?: string
}>()

const { t, locale } = useI18n()

const status = computed(() => {
  if (props.label)
    return { step: props.label, data: [] }

  const step = t(`player.steps.${props.step}`)
  const stats = props.stats

  if (!stats || props.step === 'reconnecting')
    return { step, data: [] }

  const parts
    = props.step === 'buffering' || props.step === 'slow'
      ? [
          t('player.progress', {
            n: Math.round((props.progress ?? 0) * 100),
          }),
          t('player.stats.speed', {
            value: formatMegabits(stats.downloadSpeed, locale.value),
          }),
        ]
      : [
          stats.peers.connected > 0
            ? t('player.peers', stats.peers.connected)
            : t('player.found', stats.peers.found),
        ]

  return { step, data: parts }
})

const seeders = computed(() => {
  if (props.label || (props.step !== 'buffering' && props.step !== 'slow'))
    return undefined

  const count = props.stats?.peers.seeders
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
    ? count
    : undefined
})

// Ноль соединений не доказывает отсутствие сидов: описываем только наблюдаемое.
const hint = computed(() => {
  if (props.label)
    return ''

  if (props.step === 'waitingPeers')
    return t('player.waitingHint')

  return props.step === 'connectingPeers'
    ? t('player.connectingPeersHint')
    : ''
})

// Появление цифр и смена их вида растворяются, а новые цифры того же вида — нет
const detailsKind = computed(() => {
  if (!status.value.data.length)
    return 'empty'

  return props.step === 'buffering' || props.step === 'slow'
    ? 'buffer'
    : 'peers'
})

/**
 * Числа — в ячейках постоянной ширины: строка по центру не сдвигается, когда
 * «9 %» становится «10 %», а «0,9» — «12,4»
 */
const dataParts = computed(() =>
  status.value.data.map(value =>
    value
      .split(/(\d+(?:[.,]\d+)?)/)
      .filter(Boolean)
      .map(text => ({
        text,
        number: /^\d/.test(text),
        fraction: /[.,]/.test(text),
      })),
  ),
)
</script>

<template>
  <div class="buffering" role="status">
    <!--
      Две строки: шаг и подробности под ним (пиры, буфер и скорость, подсказка).
      Варианты строки лежат в одной ячейке grid и сменяются растворением, а
      строка подробностей держит высоту и пустой: шаг не сдвигается
    -->
    <div class="buffering__line buffering__line--step">
      <Transition name="buffering-swap">
        <p :key="status.step" class="buffering__text">
          {{ status.step }}
        </p>
      </Transition>
    </div>
    <div class="buffering__line buffering__line--details">
      <Transition name="buffering-swap">
        <p v-if="hint" key="hint" class="buffering__text buffering__hint">
          {{ hint }}
        </p>
        <p v-else :key="detailsKind" class="buffering__text buffering__metrics">
          <span
            v-for="(parts, index) in dataParts"
            :key="index"
            class="buffering__metric"
          >
            <span
              v-for="(part, partIndex) in parts"
              :key="partIndex"
              :class="{
                'buffering__number': part.number,
                'buffering__number--fraction': part.fraction,
              }"
            >{{ part.text }}</span>
          </span>
          <span
            v-if="seeders !== undefined"
            class="buffering__metric buffering__metric--seeders"
            role="img"
            :aria-label="t('player.stats.seeders', { n: seeders })"
            :title="t('player.stats.seeders', { n: seeders })"
          >
            <AppIcon name="arrowUp" class="buffering__stat-icon" />
            <span>{{ seeders }}</span>
          </span>
        </p>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* Статус появляется вместе с торшером через --loader-delay: быстрый старт и
   запуск, сразу кончившийся ошибкой, им не мелькают */
.buffering {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: var(--space-2);
  font-size: var(--font-size-s);
  opacity: 0;
  animation: buffering-appear var(--motion-fast) var(--motion-easing) var(--loader-delay) forwards;
}

@keyframes buffering-appear {
  to {
    opacity: 1;
  }
}

/* Тихие строки, а не плашка: главное на сцене — торшер */
.buffering__line {
  display: grid;
  justify-items: center;
  text-align: center;
}

.buffering__line--step {
  font-weight: 500;
}

.buffering__line--details {
  min-height: 1.4em;
  margin-top: calc(var(--u) * 4);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.buffering__text {
  grid-area: 1 / 1;
  margin: 0;
  line-height: 1.4;
  white-space: nowrap;
}

.buffering__hint {
  max-width: calc(var(--u) * 900);
  white-space: normal;
}

.buffering__metrics,
.buffering__metric--seeders {
  display: inline-flex;
  align-items: center;
}

.buffering__metric + .buffering__metric {
  margin-left: var(--space-3);
}

.buffering__stat-icon {
  width: calc(var(--u) * 22);
  height: calc(var(--u) * 22);
  margin-right: calc(var(--u) * 8);
}

/* Цифры одной ширины (tabular-nums), поэтому ch — ширина любой цифры */
.buffering__number {
  display: inline-block;
  min-width: 2ch;
  text-align: right;
}

.buffering__number--fraction {
  min-width: 3.4ch;
}

.buffering-swap-enter-active,
.buffering-swap-leave-active {
  transition: opacity var(--motion-base) var(--motion-easing);
}

.buffering-swap-enter-from,
.buffering-swap-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .buffering-swap-enter-active,
  .buffering-swap-leave-active {
    transition: none;
  }
}
</style>
