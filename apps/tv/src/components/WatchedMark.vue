<script setup lang="ts">
import AppIcon from './AppIcon.vue'
</script>

<template>
  <!-- Отметка «просмотрено» в правом верхнем углу кадра или постера -->
  <span class="watched-mark">
    <AppIcon name="check" />
  </span>
</template>

<style scoped>
.watched-mark {
  position: absolute;
  top: calc(var(--u) * 12);
  right: calc(var(--u) * 12);
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 44);
  height: calc(var(--u) * 44);
  border-radius: 50%;
  background: var(--color-ok);
  color: var(--color-bg);
  font-size: calc(var(--u) * 26);
}
</style>
