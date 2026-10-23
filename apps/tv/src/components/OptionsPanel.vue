<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useSlots } from 'vue'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../focus/index.ts'
import AppIcon from './AppIcon.vue'
import FocusSection from './FocusSection.vue'

export interface PanelOption {
  id: string
  label: string
  /** Вторая строка пункта, приглушённая */
  hint?: string
  selected: boolean
}

/**
 * Правая панель выбора одного варианта: сортировка и фильтры «Источников».
 * Выбор применяется и закрывает панель; Back и клик по скриму — закрывают.
 */
defineProps<{
  title: string
  options: PanelOption[]
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

const focus = useFocus()
const slots = useSlots()
const panel = ref<HTMLElement>()

// Панель открывается на выбранном пункте: шаг вниз от него — соседнее значение
onMounted(() => {
  nextTick(() => {
    const selected = panel.value?.querySelector<HTMLElement>(
      '.options__row[aria-pressed="true"]',
    )

    if (selected)
      focus.focusOn(selected)
  })
})

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
      ref="panel"
      class="options__panel"
      :aria-label="title"
      :[NATIVE_WHEEL_ATTRIBUTE]="true"
    >
      <h2 class="options__title">
        {{ title }}
      </h2>
      <!-- Над списком — своя секция (поле ввода): вверх из списка — в неё -->
      <FocusSection
        v-if="slots.top"
        name="options-top"
        :edges="{ down: 'options-panel' }"
      >
        <slot name="top" />
      </FocusSection>
      <FocusSection
        name="options-panel"
        class="options__list"
        :edges="slots.top ? { up: 'options-top' } : undefined"
        autofocus
      >
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
          <span class="options__text">
            {{ option.label }}
            <span v-if="option.hint" class="options__hint">{{
              option.hint
            }}</span>
          </span>
        </button>
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

.options__text {
  min-width: 0;
}

.options__hint {
  display: block;
  margin-top: calc(var(--u) * 4);
  font-size: calc(var(--u) * 22);
  font-weight: 400;
  opacity: 0.7;
}

.options__check :deep(.icon) {
  width: 100%;
  height: 100%;
}
</style>
