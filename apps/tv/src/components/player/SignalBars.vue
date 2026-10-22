<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// Уровень сети палочками, как у сотовой связи: 0–4 закрашенных из четырёх
defineProps<{
  level: number
  low?: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <span
    class="signal"
    :class="{ 'signal--low': low }"
    role="img"
    :aria-label="t('player.signal', { n: level })"
  >
    <span
      v-for="bar in 4"
      :key="bar"
      class="signal__bar"
      :class="{ 'signal__bar--on': bar <= level }"
      :style="{ height: `${bar * 25}%` }"
    />
  </span>
</template>

<style scoped>
.signal {
  display: inline-flex;
  align-items: flex-end;
  width: calc(var(--u) * 26);
  height: calc(var(--u) * 20);
}

.signal__bar {
  flex: 1;
  border-radius: calc(var(--u) * 2);
  background: currentColor;
  /* Все четыре видны всегда: меняется заливка, а не число палочек */
  opacity: 0.35;
}

/* Без gap: flex-gap нет в Chromium 68 */
.signal__bar + .signal__bar {
  margin-left: calc(var(--u) * 2);
}

.signal__bar--on {
  opacity: 1;
}

.signal--low {
  color: var(--color-warn);
}
</style>
