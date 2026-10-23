<script setup lang="ts">
// Правая панель плеера: дорожки, серии, источник, настройки. Скрим слева,
// заголовок, подпись и содержимое; внизу — подсказка. Клик по скриму (мышь,
// курсор Magic Remote) — к фильму: панель закрывается
defineProps<{
  title: string
  /** Под заголовком: какой файл играет, что сохранится при смене */
  caption?: string
  hint?: string
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="panel">
    <div class="panel__scrim" @mousedown.prevent @click="emit('close')" />
    <aside class="panel__body" :aria-label="title">
      <h2 class="panel__title">
        {{ title }}
      </h2>
      <p class="panel__caption">
        {{ caption }}
      </p>
      <div class="panel__content">
        <slot />
      </div>
      <p v-if="hint" class="panel__hint">
        {{ hint }}
      </p>
    </aside>
  </div>
</template>

<style scoped>
.panel__scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.35);
}

.panel__body {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: calc(var(--u) * 760);
  padding: var(--safe-y) var(--safe-x) var(--safe-y) calc(var(--u) * 56);
  background: var(--color-surface);
}

.panel__title {
  margin: 0 0 calc(var(--u) * 8);
  font-size: var(--font-size-l);
  font-weight: 700;
}

/* Строка подписи держит место и пустой: содержимое не прыгает, когда она приходит */
.panel__caption {
  min-height: calc(var(--font-size-s) * var(--line-height));
  margin: 0 0 calc(var(--u) * 22);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.panel__content {
  position: relative;
  flex: 1;
  min-height: 0;
}

.panel__hint {
  margin: 0;
  padding-top: calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
