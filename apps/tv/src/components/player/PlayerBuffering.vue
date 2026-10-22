<script setup lang="ts">
import type { TorrentStats } from '@torsher/api-client'
import type { BufferingStep } from '../../lib/player.ts'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSourceLabels } from '../../composables/useSourceLabels.ts'
import { formatSpeed } from '../../lib/player.ts'
import AppLoader from '../AppLoader.vue'

const props = defineProps<{
  title: string
  step: BufferingStep
  stats: TorrentStats | undefined
  // Из карточки тайтла: кадр на фон, логотип и «Сезон 1 · Серия 1 · Название»
  backdrop?: string
  logo?: string
  subtitle?: string
}>()

// Столько буфера впереди считаем «почти готово»: полоса не стоит на месте
const BUFFER_TARGET_BYTES = 16 * 1024 * 1024

const { t, locale } = useI18n()
const { sizeLabel } = useSourceLabels()

const logoFailed = ref(false)

watch(
  () => props.logo,
  () => {
    logoFailed.value = false
  },
)

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
    <img
      v-if="backdrop"
      class="buffering__backdrop"
      :src="backdrop"
      alt=""
      decoding="async"
    >
    <div class="buffering__shade" />

    <div class="buffering__center">
      <img
        v-if="logo && !logoFailed"
        class="buffering__logo"
        :src="logo"
        :alt="title"
        decoding="async"
        @error="logoFailed = true"
      >
      <p v-else class="buffering__title">
        {{ title }}
      </p>
      <p v-if="subtitle" class="buffering__subtitle">
        {{ subtitle }}
      </p>
      <AppLoader class="buffering__loader" />
    </div>

    <div class="buffering__bottom">
      <div class="buffering__track">
        <span
          class="buffering__fill"
          :style="{ transform: `scaleX(${share})` }"
        />
        <span class="buffering__sweep" />
      </div>
      <div class="buffering__meta">
        <span class="buffering__step">{{ t(`player.steps.${step}`) }}</span>
        <span class="buffering__network">{{ network }}</span>
      </div>
      <p v-if="step === 'waitingPeers'" class="buffering__hint">
        {{ t("player.waitingHint") }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.buffering {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: var(--color-bg);
}

.buffering__backdrop,
.buffering__shade {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.buffering__backdrop {
  object-fit: cover;
}

/* Кадр приглушён: текст и лоадер читаются на светлом и тёмном */
.buffering__shade {
  background-image:
    radial-gradient(ellipse at center, rgba(11, 13, 18, 0.55) 0%, rgba(11, 13, 18, 0.8) 70%),
    linear-gradient(0deg, var(--color-bg) 0%, rgba(11, 13, 18, 0) 40%);
}

.buffering__center {
  position: absolute;
  top: 50%;
  right: var(--safe-x);
  left: var(--safe-x);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  transform: translateY(-55%);
}

.buffering__logo {
  max-width: calc(var(--u) * 720);
  max-height: calc(var(--u) * 220);
  object-fit: contain;
}

.buffering__title {
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-xl);
  font-weight: 700;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.buffering__subtitle {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
}

.buffering__loader {
  margin-top: calc(var(--u) * 56);
}

@keyframes buffering-sweep {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(500%);
  }
}

/* Внизу: полоса подготовки и строка «шаг · сеть» */
.buffering__bottom {
  position: absolute;
  right: var(--safe-x);
  bottom: var(--safe-y);
  left: var(--safe-x);
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
  /* Цифры одной ширины: счётчики обновляются каждую секунду и не дёргают строку */
  font-variant-numeric: tabular-nums;
}

.buffering__hint {
  max-width: calc(var(--u) * 900);
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
