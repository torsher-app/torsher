<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { IconName } from './AppIcon.vue'
import AppIcon from './AppIcon.vue'

/**
 * Первая плитка ряда: открывает полный список — серий сезона или всего
 * домашнего видео. Размер — как у карточек 16:9 ряда, чтобы ряд не менял шаг.
 */
withDefaults(
  defineProps<{
    // Вторая строка подписи: сколько всего
    meta: string
    // Первая строка; по умолчанию — «Все серии»
    title?: string
    icon?: IconName
  }>(),
  { title: undefined, icon: 'list' },
)

defineEmits<{ select: [] }>()

const { t } = useI18n()
</script>

<template>
  <button
    v-focusable
    class="card episode-list-card"
    type="button"
    @click="$emit('select')"
  >
    <span class="episode-list-card__frame">
      <AppIcon :name="icon" class="episode-list-card__icon" />
      <span class="card__ring" />
    </span>
    <span class="episode-list-card__title">{{
      title ?? t("title.episodeList.open")
    }}</span>
    <span class="episode-list-card__meta">{{ meta }}</span>
  </button>
</template>

<style scoped>
.episode-list-card {
  position: relative;
  display: block;
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
.episode-list-card__frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.episode-list-card__icon {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--u) * 72);
  height: calc(var(--u) * 72);
  margin: calc(var(--u) * -36) 0 0 calc(var(--u) * -36);
  color: var(--color-text-muted);
}

.episode-list-card__title,
.episode-list-card__meta {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.episode-list-card__title {
  margin-top: calc(var(--u) * 16);
  font-size: calc(var(--u) * 26);
  font-weight: 600;
}

.episode-list-card__meta {
  min-height: calc(var(--font-size-s) * var(--line-height));
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
