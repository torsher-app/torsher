<script setup lang="ts">
import AppIcon from '../AppIcon.vue'

// Строка панели плеера: фокус-язык строк — белая заливка с тёмным текстом.
// Слева — галочка выбранного (`check`) или своя картинка (слот `leading`)
withDefaults(
  defineProps<{
    label: string
    /** Вторая строка: тип озвучки, кодек, размер, прогресс серии */
    detail?: string
    check?: boolean
    selected?: boolean
  }>(),
  { detail: '', check: false, selected: false },
)

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    v-focusable
    class="panel-row"
    type="button"
    :aria-pressed="check ? selected : undefined"
    @click="$emit('select')"
  >
    <span v-if="check" class="panel-row__check">
      <AppIcon v-if="selected" name="check" />
    </span>
    <slot name="leading" />
    <span class="panel-row__text">
      <span class="panel-row__label">{{ label }}</span>
      <span v-if="detail" class="panel-row__detail">{{ detail }}</span>
    </span>
    <slot name="trailing" />
  </button>
</template>

<style scoped>
.panel-row {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: calc(var(--u) * 8);
  padding: calc(var(--u) * 20) calc(var(--u) * 24);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
}

.panel-row:focus {
  --bump-scale: var(--focus-scale);

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.panel-row__check {
  width: calc(var(--u) * 32);
  height: calc(var(--u) * 32);
  margin-right: calc(var(--u) * 18);
  flex-shrink: 0;
}

.panel-row__check :deep(.icon) {
  width: 100%;
  height: 100%;
}

.panel-row__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.panel-row__label,
.panel-row__detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-row__label {
  font-size: var(--font-size-m);
  font-weight: 600;
}

.panel-row__detail {
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.panel-row:focus .panel-row__detail {
  color: inherit;
  opacity: 0.7;
}
</style>
