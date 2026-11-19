<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useChipRibbon } from '../composables/useChipRibbon.ts'
import { useFocus } from '../focus/index.ts'

defineProps<{ title: string, total?: number }>()

const { view, native, trackStyle, reveal, onScroll } = useChipRibbon()
const focus = useFocus()
const stopFocus = focus.onFocus((el, via) => {
  if (via !== 'pointer' && view.value?.contains(el))
    reveal(el)
})

onBeforeUnmount(stopFocus)
</script>

<template>
  <div
    class="mine-section"
    :class="{
      'mine-section--compact': !$slots.default,
      'mine-section--actions': !!$slots.actions,
    }"
  >
    <header class="mine-header">
      <div class="mine-header__heading">
        <h2 class="mine-header__title">
          {{ title }}
          <span v-if="total !== undefined" class="mine-header__total">{{
            total
          }}</span>
          <slot name="title-extra" />
        </h2>
        <div v-if="$slots.actions" class="mine-header__actions">
          <slot name="actions" />
        </div>
      </div>
      <div v-if="$slots.default" class="mine-header__controls">
        <div
          ref="view"
          class="mine-header__filters"
          :class="{ 'mine-header__filters--native': native }"
          @scroll.passive="onScroll"
        >
          <div class="mine-header__track" :style="trackStyle">
            <slot />
          </div>
        </div>
      </div>
      <div v-if="$slots.scope" class="mine-header__scope">
        <slot name="scope" />
      </div>
    </header>
    <slot name="content" />
  </div>
</template>

<style scoped>
.mine-section {
  /* Конец строки чипов и зазор до содержимого прежнего «Продолжить». */
  --mine-title-height: calc(var(--font-size-l) * var(--line-height));
  --mine-content-gap: calc(var(--u) * 204 - var(--mine-title-height) - var(--u) * 90);
  --mine-content-top: calc(var(--safe-y) + var(--u) * 204);
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

.mine-section--compact {
  --mine-content-top: calc(var(--safe-y) + var(--mine-title-height) + var(--mine-content-gap));
}

.mine-section--compact.mine-section--actions {
  /* Действие высотой 64u центрировано относительно строки заголовка. */
  --mine-content-top: calc(var(--safe-y) + (var(--mine-title-height) + var(--u) * 64) / 2 + var(--mine-content-gap));
}

.mine-header {
  position: absolute;
  top: var(--safe-y);
  right: 0;
  left: 0;
}

.mine-header__heading {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  height: calc(var(--font-size-l) * var(--line-height));
}

.mine-header__title {
  display: flex;
  align-items: baseline;
  flex: 1;
  min-width: 0;
  height: calc(var(--font-size-l) * var(--line-height));
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-l);
  font-weight: 700;
  white-space: nowrap;
}

.mine-header__total {
  margin-left: calc(var(--u) * 16);
  color: var(--color-text-dim);
  font-weight: 600;
}

.mine-header__controls {
  min-height: calc(var(--u) * 76);
  margin-top: calc(var(--u) * 20);
  padding: calc(var(--u) * 6) 0;
}

.mine-header__filters {
  margin: calc(var(--focus-ring-gap) * -1);
  padding: var(--focus-ring-gap);
  overflow: hidden;
}

.mine-header__filters--native {
  overflow-x: auto;
  overflow-y: hidden;
}

.mine-header__filters::-webkit-scrollbar {
  display: none;
}

.mine-header__track {
  position: relative;
  min-width: 100%;
  width: max-content;
  transition: transform var(--motion-base) var(--motion-easing);
}

.mine-header__track :deep(.chip) {
  flex-shrink: 0;
}

.mine-header :deep(.chip .icon) {
  margin-left: calc(var(--u) * 8);
}

.mine-header :deep(.chip .chip__leading-icon) {
  margin-left: 0;
  margin-right: calc(var(--u) * 8);
}

.mine-header__actions {
  flex-shrink: 0;
  margin-left: calc(var(--u) * 32);
}

.mine-header__scope {
  margin-top: calc(var(--u) * 20);
  padding: calc(var(--u) * 6) 0;
}
</style>
