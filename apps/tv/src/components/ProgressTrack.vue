<script setup lang="ts">
defineProps<{
  /** Доля просмотренного 0…1 */
  value: number
}>()
</script>

<template>
  <!-- Полоса по низу кадра: ширина — transform, без перерисовки -->
  <span class="progress-track">
    <span
      class="progress-track__value"
      :style="{ transform: `scaleX(${Math.min(1, Math.max(0, value))})` }"
    />
  </span>
</template>

<style scoped>
.progress-track {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: calc(var(--u) * 6);
  overflow: hidden;
  border-radius: 0 0 var(--radius-m) var(--radius-m);
  background: rgba(255, 255, 255, 0.25);
}

.progress-track__value {
  display: block;
  height: 100%;
  background: var(--color-accent);
  transform-origin: left center;
}
</style>
