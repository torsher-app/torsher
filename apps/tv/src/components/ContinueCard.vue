<script setup lang="ts">
import type { ContinueCard } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeLabels } from '../composables/useResumeLabels.ts'
import { watchedShare } from '../lib/continue.ts'
import { openTitleActions } from '../titleActions.ts'
import AppIcon from './AppIcon.vue'
import ProgressTrack from './ProgressTrack.vue'

const props = withDefaults(
  defineProps<{
    item: ContinueCard
    // Далёкие от фокуса ряды не держат картинки в памяти ТВ
    loadImage?: boolean
  }>(),
  { loadImage: true },
)

defineEmits<{ select: [] }>()

const { t } = useI18n()
const { resumeLine } = useResumeLabels()

// Долгий OK — меню тайтла («Брошено» убирает его из ряда)
function openActions() {
  openTitleActions({
    id: props.item.id,
    title: props.item.title,
    kind: props.item.kind,
  })
}

const share = computed(() => watchedShare(props.item))
</script>

<template>
  <button
    v-focusable
    class="card continue-card"
    type="button"
    data-long-press
    @click="$emit('select')"
    @longpress="openActions"
  >
    <span class="continue-card__frame">
      <img
        v-if="item.image && loadImage"
        class="continue-card__image"
        :src="item.image"
        alt=""
        decoding="async"
      >
      <span v-else-if="!item.image" class="continue-card__placeholder">
        {{ item.title }}
      </span>
      <!-- Новая серия «Следить»: колокольчик поверх кадра, кадр не сдвигается -->
      <span
        v-if="item.followNewEpisode"
        class="continue-card__bell"
        :aria-label="t('follow.newEpisode')"
        role="img"
      >
        <AppIcon name="bell" />
      </span>
      <ProgressTrack v-if="share > 0" :value="share" />
      <span class="card__ring" />
    </span>
    <span class="continue-card__title">{{ item.title }}</span>
    <span class="continue-card__meta">{{ resumeLine(item) }}</span>
  </button>
</template>

<style scoped>
.continue-card {
  position: relative;
  display: block;
  flex-shrink: 0;
  width: calc(var(--u) * 400);
  padding: 0;
  border: 0;
  border-radius: var(--radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

/* 16:9 через padding: aspect-ratio появился только в Chromium 88 */
.continue-card__frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.continue-card__image,
.continue-card__placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
}

.continue-card__image {
  object-fit: cover;
}

/* Как значок «слежу» на постере */
.continue-card__bell {
  position: absolute;
  z-index: 1;
  top: calc(var(--u) * 12);
  left: calc(var(--u) * 12);
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 36);
  height: calc(var(--u) * 36);
  border-radius: calc(var(--u) * 18);
  background: rgba(10, 12, 18, 0.78);
  color: var(--color-accent);
  font-size: calc(var(--u) * 22);
  line-height: 1;
}

.continue-card__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  text-align: center;
}

.continue-card__title,
.continue-card__meta {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.continue-card__title {
  margin-top: calc(var(--u) * 16);
  font-size: calc(var(--u) * 26);
  font-weight: 600;
}

.continue-card__meta {
  min-height: calc(var(--font-size-s) * var(--line-height));
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
