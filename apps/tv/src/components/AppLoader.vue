<script setup lang="ts">
/**
 * Общий лоадер витрины: кольцо с бегущей дугой и дышащей точкой. Встраивается
 * по месту (строка, список, экран подготовки) и ничего не сдвигает: размер
 * задаёт родитель через `size`. Только transform и opacity — дёшево на ТВ.
 */
withDefaults(
  defineProps<{
    // Диаметр в пикселях макета
    size?: number
    // Подпись под кольцом: «Подключаемся к раздаче…»
    label?: string
  }>(),
  { size: 96, label: '' },
)
</script>

<template>
  <span class="loader" role="status">
    <span
      class="loader__ring"
      :style="{ '--loader-size': size }"
      aria-hidden="true"
    >
      <span class="loader__arc" />
      <span class="loader__core" />
    </span>
    <span v-if="label" class="loader__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.loader {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
}

.loader__ring {
  position: relative;
  width: calc(var(--u) * var(--loader-size));
  height: calc(var(--u) * var(--loader-size));
  border: calc(var(--u) * var(--loader-size) / 24) solid rgba(242, 244, 248, 0.14);
  border-radius: 50%;
}

.loader__arc {
  position: absolute;
  top: calc(var(--u) * var(--loader-size) / -24);
  right: calc(var(--u) * var(--loader-size) / -24);
  bottom: calc(var(--u) * var(--loader-size) / -24);
  left: calc(var(--u) * var(--loader-size) / -24);
  border: calc(var(--u) * var(--loader-size) / 24) solid transparent;
  border-top-color: var(--color-accent);
  border-right-color: var(--color-accent);
  border-radius: 50%;
  animation: loader-spin 1100ms cubic-bezier(0.5, 0.15, 0.5, 0.85) infinite;
}

.loader__core {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--u) * var(--loader-size) / 5);
  height: calc(var(--u) * var(--loader-size) / 5);
  border-radius: 50%;
  background: var(--color-accent);
  transform: translate(-50%, -50%);
  animation: loader-breathe 1600ms ease-in-out infinite;
}

.loader__label {
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

@keyframes loader-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes loader-breathe {
  0%,
  100% {
    opacity: 0.35;
    transform: translate(-50%, -50%) scale(0.7);
  }

  50% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
</style>
