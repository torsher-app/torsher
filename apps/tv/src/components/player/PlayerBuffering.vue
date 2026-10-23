<script setup lang="ts">
import type { TorrentStats } from '@torsher/api-client'
import type { StageStep } from '../../lib/player.ts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSourceLabels } from '../../composables/useSourceLabels.ts'
import { formatSpeed } from '../../lib/player.ts'

// Низ экрана подготовки (`PlayerStage`): полоса, шаг и сеть
const props = defineProps<{
  step: StageStep
  stats: TorrentStats | undefined
  /** Своя подпись шага: экран подготовки ищет серию до потока */
  label?: string
}>()

// Столько буфера впереди считаем «почти готово»: полоса не стоит на месте
const BUFFER_TARGET_BYTES = 16 * 1024 * 1024

const { t, locale } = useI18n()
const { sizeLabel } = useSourceLabels()

/**
 * Полоса подготовки: треть — пиры, остальное — буфер впереди. Точного конца
 * нет (старт решает `<video>`), поэтому до 95 %, а живость даёт бегущий блик.
 */
const share = computed(() => {
  if (props.step !== 'buffering')
    return 0.12

  const ahead = props.stats?.file.bufferedAhead ?? 0

  return 0.33 + 0.62 * Math.min(1, ahead / BUFFER_TARGET_BYTES)
})

// Внизу справа — сеть: пиры, скорость и сколько уже впереди
const network = computed(() => {
  const stats = props.stats

  if (!stats)
    return ''

  const parts = [
    stats.peers.connected > 0
      ? t('player.peers', stats.peers.connected)
      : t('player.found', stats.peers.found),
    t('player.speed', {
      value: formatSpeed(stats.downloadSpeed, locale.value),
    }),
  ]

  if (stats.file.bufferedAhead > 0) {
    parts.push(
      t('player.ahead', { size: sizeLabel(stats.file.bufferedAhead) }),
    )
  }

  return parts.join(' · ')
})
</script>

<template>
  <div class="buffering" role="status">
    <div class="buffering__track">
      <span
        class="buffering__fill"
        :style="{ transform: `scaleX(${share})` }"
      />
      <span class="buffering__sweep" />
    </div>
    <div class="buffering__meta">
      <span class="buffering__step">{{
        label ?? t(`player.steps.${step}`)
      }}</span>
      <span class="buffering__network">{{ network }}</span>
    </div>
    <p v-if="step === 'waitingPeers'" class="buffering__hint">
      {{ t("player.waitingHint") }}
    </p>
  </div>
</template>

<style scoped>
/* Полоса появляется вместе с торшером через --loader-delay: если запуск сразу
   кончится ошибкой, «Подключаемся к пирам» не мелькнёт перед ней */
.buffering {
  opacity: 0;
  animation: buffering-appear var(--motion-fast) var(--motion-easing) var(--loader-delay) forwards;
}

@keyframes buffering-appear {
  to {
    opacity: 1;
  }
}

@keyframes buffering-sweep {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(500%);
  }
}

.buffering__track {
  position: relative;
  height: calc(var(--u) * 6);
  overflow: hidden;
  border-radius: calc(var(--u) * 3);
  background: rgba(242, 244, 248, 0.16);
}

.buffering__fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  background: var(--color-accent);
  transform-origin: left center;
  transition: transform 600ms var(--motion-easing);
}

.buffering__sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 20%;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.45) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: buffering-sweep 1800ms linear infinite;
}

.buffering__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: var(--space-2);
  font-size: var(--font-size-s);
}

.buffering__step {
  font-weight: 600;
}

.buffering__network {
  color: var(--color-text-muted);
}

.buffering__hint {
  max-width: calc(var(--u) * 900);
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
