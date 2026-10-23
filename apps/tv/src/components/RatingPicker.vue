<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFocus } from '../focus/index.ts'

/**
 * Своя оценка одним рядом 1–10. Цифры пульта ставят её сразу (0 — 10),
 * OK на текущей оценке её снимает.
 */
const props = defineProps<{ value: number | null }>()

const emit = defineEmits<{ select: [value: number | null] }>()

const { t } = useI18n()
const focus = useFocus()
const row = ref<HTMLElement>()

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
// Без оценки фокус встаёт на середину шкалы со сдвигом к хорошему
const DEFAULT_FOCUS = 7

function choose(value: number) {
  emit('select', value === props.value ? null : value)
}

const stopKey = focus.onKey((action) => {
  if (action.type !== 'digit')
    return false

  emit('select', action.digit === 0 ? 10 : action.digit)

  return true
})

onMounted(() => {
  nextTick(() => {
    const el = row.value?.querySelector<HTMLElement>(
      `[data-value="${props.value ?? DEFAULT_FOCUS}"]`,
    )

    if (el)
      focus.focusOn(el)
  })
})

onBeforeUnmount(stopKey)
</script>

<template>
  <div ref="row" class="rating-picker">
    <button
      v-for="item in VALUES"
      :key="item"
      v-focusable
      class="chip rating-picker__value"
      :class="{ 'chip--selected': item === value }"
      :data-value="item"
      type="button"
      :aria-pressed="item === value"
      @click="choose(item)"
    >
      {{ item }}
    </button>
  </div>
  <p class="rating-picker__hint">
    {{ t(value ? "rating.hintRated" : "rating.hint") }}
  </p>
  <button
    v-if="value"
    v-focusable
    class="rating-picker__clear"
    type="button"
    @click="emit('select', null)"
  >
    {{ t("rating.clear") }}
  </button>
</template>

<style scoped>
.rating-picker {
  display: flex;
  margin-bottom: calc(var(--u) * 28);
}

.rating-picker__value {
  justify-content: center;
  width: calc(var(--u) * 54);
  margin-right: calc(var(--u) * 8);
  padding: 0;
  font-variant-numeric: tabular-nums;
}

.rating-picker__value:last-child {
  margin-right: 0;
}

.rating-picker__hint {
  margin: 0 0 calc(var(--u) * 28);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

/* Как строка списка правой панели */
.rating-picker__clear {
  display: flex;
  align-items: center;
  width: 100%;
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

.rating-picker__clear:focus {
  --bump-scale: 1.02;

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}
</style>
