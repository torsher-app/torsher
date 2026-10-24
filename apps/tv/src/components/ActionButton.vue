<script setup lang="ts">
import type { IconName } from './AppIcon.vue'
import { computed, inject, nextTick, ref, useSlots, watch } from 'vue'
import { ROW_FIT } from '../composables/useRowFit.ts'
import { captionShift } from '../lib/rowFit.ts'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  label: string
  /** Вторая строка: значение, качество, подсказка */
  value?: string
  icon?: IconName
  /** Чип, а не кнопка: тот же фокус-язык, меньше и круглее */
  chip?: boolean
  /** Главная кнопка ряда: держит текст до последней ступени сжатия */
  primary?: boolean
  /** Всегда только значок: название — подписью в фокусе */
  iconOnly?: boolean
}>()

const SAFE_X = 96

const slots = useSlots()

const root = ref<HTMLButtonElement>()
const labelEl = ref<HTMLElement>()
const valueEl = ref<HTMLElement>()
const captionEl = ref<HTMLElement>()
const captioned = ref(false)
const shift = ref(0)
const fit = inject(ROW_FIT, undefined)

const caption = computed(() =>
  props.value ? `${props.label} · ${props.value}` : props.label,
)

// Строка обрезана многоточием или спрятана ступенью сжатия
function clipped(el: HTMLElement | undefined) {
  return (
    !el || el.getClientRects().length === 0 || el.scrollWidth > el.clientWidth
  )
}

function bounds(button: HTMLElement) {
  const block = button.closest<HTMLElement>('[data-fit]')

  if (block) {
    const rect = block.getBoundingClientRect()

    return { left: rect.left, width: rect.width }
  }

  const safe = (window.innerWidth / 1920) * SAFE_X

  return { left: safe, width: window.innerWidth - safe * 2 }
}

/**
 * Подпись — полное название, когда на кнопке его не видно целиком. Замер на
 * фокусе: подпись — свой слой с `opacity`, кнопка и соседи не двигаются
 */
function measure() {
  const button = root.value

  if (!button || document.activeElement !== button)
    return

  captioned.value
    = props.iconOnly
      || clipped(labelEl.value)
      || (!!props.value && clipped(valueEl.value))

  if (!captioned.value || !captionEl.value)
    return

  const rect = button.getBoundingClientRect()

  shift.value = captionShift(
    { left: rect.left, width: rect.width },
    captionEl.value.offsetWidth,
    bounds(button),
  )
}

watch(
  () => [props.label, props.value, fit?.value],
  () => nextTick(measure),
)
</script>

<template>
  <button
    ref="root"
    class="action-button"
    :class="[
      chip ? 'chip' : 'action',
      {
        'action--primary': primary && !chip,
        'action-button--primary': primary,
        'action-button--valued': !!value,
        'action-button--icon': iconOnly,
        'action-button--iconed': !!icon || !!slots.icon,
        'action-button--captioned': captioned,
      },
    ]"
    type="button"
    :aria-label="iconOnly ? label : undefined"
    @focus="measure"
  >
    <!-- Свой значок (лоадер вместо значка) — слотом, с классом `action-button__icon` -->
    <slot name="icon">
      <AppIcon v-if="icon" :name="icon" class="action-button__icon" />
    </slot>
    <span v-if="!iconOnly" class="action-button__text">
      <span ref="labelEl" class="action-button__label">{{ label }}</span>
      <span v-if="value" ref="valueEl" class="action-button__value">{{
        value
      }}</span>
    </span>
    <slot />
    <span
      ref="captionEl"
      class="action-button__caption"
      :style="shift ? { marginLeft: `${shift}px` } : undefined"
      aria-hidden="true"
    >{{ caption }}</span>
  </button>
</template>
