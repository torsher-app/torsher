<template>
  <span class="key-hint">
    <span class="key-hint__key"><slot name="key">OK</slot></span>
    <slot />
  </span>
</template>

<style scoped>
.key-hint {
  display: inline-flex;
  align-items: center;
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
}

.key-hint__key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: calc(var(--u) * 40);
  height: calc(var(--u) * 32);
  margin-right: calc(var(--u) * 10);
  padding: 0 calc(var(--u) * 8);
  border: calc(var(--u) * 2) solid var(--color-text-dim);
  border-radius: var(--radius-s);
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 17);
  font-weight: 600;
}
</style>
