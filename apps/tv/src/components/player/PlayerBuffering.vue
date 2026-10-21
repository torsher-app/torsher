<script setup lang="ts">
import type { TorrentStats } from '@torsher/api-client'
import type { BufferingStep } from '../../lib/player.ts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatSpeed } from '../../lib/player.ts'

const props = defineProps<{
  title: string
  step: BufferingStep
  stats: TorrentStats | undefined
}>()

const { t, locale } = useI18n()

const STEPS = ['peers', 'buffer', 'start'] as const

const current = computed(() => (props.step === 'buffering' ? 1 : 0))

// «Подключаемся к пирам · найдено 41 пир» → «Буферизация · 7 пиров · 2,4 МБ/с»
const detail = computed(() => {
  const stats = props.stats

  if (props.step === 'buffering' && stats) {
    return [
      t('player.peers', stats.peers.connected),
      t('player.speed', {
        value: formatSpeed(stats.downloadSpeed, locale.value),
      }),
    ].join(' · ')
  }

  if (stats && stats.peers.found > 0)
    return t('player.found', stats.peers.found)

  return ''
})
</script>

<template>
  <div class="buffering" role="status">
    <p class="buffering__title">
      {{ title }}
    </p>
    <p class="buffering__step">
      <span class="buffering__spinner" aria-hidden="true" />
      {{ t(`player.steps.${step}`)
      }}<template v-if="detail">
        · {{ detail }}
      </template>
    </p>
    <p v-if="step === 'waitingPeers'" class="buffering__hint">
      {{ t("player.waitingHint") }}
    </p>
    <ol class="buffering__progress">
      <li
        v-for="(name, index) in STEPS"
        :key="name"
        class="buffering__dot"
        :class="{ 'buffering__dot--done': index <= current }"
      >
        {{ t(`player.stepNames.${name}`) }}
      </li>
    </ol>
  </div>
</template>

<style scoped>
.buffering {
  position: absolute;
  top: 50%;
  right: var(--safe-x);
  left: var(--safe-x);
  text-align: center;
  transform: translateY(-50%);
}

.buffering__title {
  margin: 0 0 var(--space-3);
  overflow: hidden;
  font-size: var(--font-size-xl);
  font-weight: 700;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.buffering__step {
  display: inline-flex;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-m);
}

.buffering__spinner {
  width: calc(var(--u) * 28);
  height: calc(var(--u) * 28);
  margin-right: var(--space-2);
  border: calc(var(--u) * 4) solid var(--color-line);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: buffering-spin 900ms linear infinite;
}

@keyframes buffering-spin {
  to {
    transform: rotate(360deg);
  }
}

.buffering__hint {
  max-width: calc(var(--u) * 900);
  margin: var(--space-2) auto 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.buffering__progress {
  display: flex;
  justify-content: center;
  margin: var(--space-5) 0 0;
  padding: 0;
  list-style: none;
}

.buffering__dot {
  margin: 0 var(--space-2);
  padding-top: calc(var(--u) * 18);
  border-top: calc(var(--u) * 6) solid var(--color-line);
  min-width: calc(var(--u) * 160);
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
}

.buffering__dot--done {
  border-top-color: var(--color-accent);
  color: var(--color-text);
}
</style>
