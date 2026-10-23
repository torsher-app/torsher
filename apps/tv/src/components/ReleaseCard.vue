<script setup lang="ts">
import type { ReleaseCard } from '@torsher/api-client'
import { computed } from 'vue'
import { useReleaseTexts } from '../composables/useReleaseTexts.ts'
import AppIcon from './AppIcon.vue'

/**
 * Раздача без тайтла в «Библиотеке»: кадр подсказки 16:9 или заглушка, имя
 * раздачи как есть и что с распознаванием
 */
const props = withDefaults(
  defineProps<{ release: ReleaseCard, loadImage?: boolean }>(),
  { loadImage: true },
)

defineEmits<{ select: [] }>()

const texts = useReleaseTexts()
const facts = computed(() => texts.factsOf(props.release))
const status = computed(() => texts.statusOf(props.release))
</script>

<template>
  <button
    v-focusable
    class="card release-card"
    type="button"
    @click="$emit('select')"
  >
    <span class="release-card__frame">
      <img
        v-if="release.image && loadImage"
        class="release-card__image"
        :src="release.image"
        alt=""
        decoding="async"
      >
      <AppIcon v-else name="library" class="release-card__icon" />
      <span class="release-card__facts">{{ facts }}</span>
      <span class="card__ring" />
    </span>
    <span class="release-card__name">{{ release.name }}</span>
    <span class="release-card__status">{{ status }}</span>
  </button>
</template>

<style scoped>
.release-card {
  position: relative;
  display: block;
  flex-shrink: 0;
  width: calc(var(--u) * 420);
  padding: 0;
  border: 0;
  border-radius: var(--radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

/* 16:9 через padding: aspect-ratio появился только в Chromium 88 */
.release-card__frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

/* Кадр подсказки приглушён: тайтл ещё не подтверждён */
.release-card__image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
  object-fit: cover;
  opacity: 0.45;
}

.release-card__icon {
  position: absolute;
  top: 50%;
  left: 50%;
  margin: calc(var(--u) * -32) 0 0 calc(var(--u) * -32);
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 64);
}

.release-card__facts {
  position: absolute;
  bottom: calc(var(--u) * 12);
  left: calc(var(--u) * 12);
  display: flex;
  align-items: center;
  max-width: calc(100% - var(--u) * 24);
  height: calc(var(--u) * 36);
  padding: 0 calc(var(--u) * 12);
  overflow: hidden;
  border-radius: calc(var(--u) * 18);
  background: rgba(11, 13, 18, 0.72);
  font-size: calc(var(--u) * 22);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.release-card__name,
.release-card__status {
  display: block;
  min-height: calc(var(--font-size-s) * var(--line-height));
  overflow: hidden;
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Имя раздачи как есть — моноширинным, как в «Источниках» */
.release-card__name {
  margin-top: calc(var(--u) * 14);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

.release-card__status {
  color: var(--color-text-muted);
}
</style>
