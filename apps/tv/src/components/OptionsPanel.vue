<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../focus/index.ts'
import AppIcon from './AppIcon.vue'
import FocusSection from './FocusSection.vue'

export interface PanelOption {
  id: string
  label: string
  selected: boolean
  // Значение справа: своя оценка, «›» у шага дальше
  detail?: string
}

/**
 * Правая панель выбора: сортировка и фильтры «Источников», меню действий
 * тайтла. Что делает выбор, решает родитель; Back и клик по скриму — `close`.
 * Слот заменяет список своим содержимым в той же секции фокуса.
 */
defineProps<{
  title: string
  subtitle?: string
  options?: PanelOption[]
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

const focus = useFocus()

const stopKey = focus.onKey((action) => {
  if (action.type !== 'back')
    return false

  emit('close')

  return true
})

onBeforeUnmount(stopKey)
</script>

<template>
  <div class="options">
    <div class="options__scrim" @click="emit('close')" />
    <aside
      class="options__panel"
      :aria-label="title"
      :[NATIVE_WHEEL_ATTRIBUTE]="true"
    >
      <h2 class="options__title" :class="{ 'options__title--sub': subtitle }">
        {{ title }}
      </h2>
      <p v-if="subtitle" class="options__subtitle">
        {{ subtitle }}
      </p>
      <FocusSection name="options-panel" class="options__list" autofocus>
        <slot>
          <button
            v-for="option in options"
            :key="option.id"
            v-focusable
            class="options__row"
            type="button"
            :aria-pressed="option.selected"
            @click="emit('select', option.id)"
          >
            <span class="options__check">
              <AppIcon v-if="option.selected" name="check" />
            </span>
            <span class="options__label">{{ option.label }}</span>
            <span v-if="option.detail" class="options__detail">
              {{ option.detail }}
            </span>
          </button>
        </slot>
      </FocusSection>
    </aside>
  </div>
</template>

<style scoped>
.options {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
}

.options__scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.45);
}

.options__panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: calc(var(--u) * 760);
  padding: var(--safe-y) var(--safe-x) 0 calc(var(--u) * 56);
  background: var(--color-surface);
}

.options__title {
  margin: 0 0 calc(var(--u) * 30);
  font-size: var(--font-size-l);
  font-weight: 700;
}

/* Список прокручивается нативно: у озвучек бывает десяток студий */
.options__title--sub {
  margin-bottom: calc(var(--u) * 8);
}

.options__subtitle {
  margin: 0 0 calc(var(--u) * 30);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.options__list {
  flex: 1;
  margin: 0 calc(var(--u) * -16);
  padding: calc(var(--u) * 8) calc(var(--u) * 16) var(--safe-y);
  overflow-y: auto;
}

.options__list::-webkit-scrollbar {
  display: none;
}

/* Строка — фокус-язык строк: белая заливка с тёмным текстом */
.options__row {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: var(--space-1);
  padding: calc(var(--u) * 20) calc(var(--u) * 24);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: none;
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
  text-align: left;
  transition: transform var(--motion-base) var(--motion-easing);
}

.options__row:focus {
  --bump-scale: 1.02;

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.options__check {
  flex-shrink: 0;
  width: calc(var(--u) * 32);
  height: calc(var(--u) * 32);
  margin-right: calc(var(--u) * 18);
}

.options__label {
  flex: 1;
  min-width: 0;
}

.options__detail {
  flex-shrink: 0;
  margin-left: calc(var(--u) * 18);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.options__row:focus .options__detail {
  color: inherit;
}

.options__check :deep(.icon) {
  width: 100%;
  height: 100%;
}
</style>
