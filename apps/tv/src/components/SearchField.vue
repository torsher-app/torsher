<script setup lang="ts">
import AppIcon from './AppIcon.vue'
</script>

<template>
  <label class="search-field">
    <AppIcon name="search" class="search-field__icon" />
    <slot />
  </label>
</template>

<style scoped>
.search-field {
  position: relative;
  display: block;
}

.search-field__icon {
  position: absolute;
  top: 50%;
  left: calc(var(--u) * 30);
  margin-top: calc(var(--u) * -20);
  font-size: calc(var(--u) * 40);
  pointer-events: none;
}

.search-field :deep(input) {
  width: 100%;
  height: calc(var(--u) * 104);
  padding: 0 calc(var(--u) * 30) 0 calc(var(--u) * 92);
  font-size: var(--font-size-l);
  font-weight: 600;
}
</style>
