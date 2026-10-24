<script setup lang="ts">
import { ref } from 'vue'
import { useRowFit } from '../composables/useRowFit.ts'

defineProps<{
  /** Кнопки по центру окна; не влезли — прижаты к левому краю, а не обрезаны с обеих сторон */
  center?: boolean
}>()

const block = ref<HTMLElement>()

useRowFit(block)
</script>

<template>
  <!-- Два блока: кнопки сжимаются и обрезаются в своём окне, а `end`
       (настройки, сброс) стоит своей ширины — на него кнопки не наедут -->
  <div class="button-row" :class="{ 'button-row--center': center }">
    <div ref="block" class="button-row__fit">
      <slot />
    </div>
    <div v-if="$slots.end" class="button-row__end">
      <slot name="end" />
    </div>
  </div>
</template>
