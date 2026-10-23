<script setup lang="ts">
import type { HomeAlbum } from '@torsher/api-client'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { albumName, formatMonth } from '../lib/homeVideo.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import AppIcon from './AppIcon.vue'

/** Альбом домашнего видео: кадр самого позднего видео, папка, число и даты */
const props = withDefaults(
  defineProps<{ album: HomeAlbum, loadImage?: boolean }>(),
  { loadImage: true },
)

defineEmits<{ select: [] }>()

const { t } = useI18n()
// Даты — в формате языка каталога (`ru-RU`), а не кода интерфейса
const locale = useCatalogLanguage()
const broken = ref(false)

const name = computed(() =>
  props.album.album ? albumName(props.album.album) : t('homeVideo.noAlbum'),
)

// Путь альбома целиком, если он вложенный: «Отпуск 2019 / День 1»
const path = computed(() =>
  props.album.album.includes('/')
    ? props.album.album.split('/').join(' / ')
    : '',
)

const meta = computed(() => {
  const { from, to, count } = props.album
  const range
    = from && to
      ? [formatMonth(from, locale.value), formatMonth(to, locale.value)]
          .filter((value, index, list) => list.indexOf(value) === index)
          .join(' – ')
      : ''

  return [t('homeVideo.count', count), range].filter(Boolean).join(' · ')
})
</script>

<template>
  <button
    v-focusable
    class="card album-card"
    type="button"
    @click="$emit('select')"
  >
    <span class="album-card__frame">
      <img
        v-if="loadImage && !broken"
        class="album-card__image"
        :src="`/api/library/files/${album.coverId}/thumb`"
        alt=""
        decoding="async"
        @error="broken = true"
      >
      <AppIcon v-else name="homeVideo" class="album-card__icon" />
      <span class="card__ring" />
    </span>
    <span class="album-card__name" :title="path || undefined">{{ name }}</span>
    <span class="album-card__meta">{{ meta }}</span>
  </button>
</template>

<style scoped>
.album-card {
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

.album-card__frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.album-card__image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
  object-fit: cover;
}

.album-card__icon {
  position: absolute;
  top: 50%;
  left: 50%;
  margin: calc(var(--u) * -32) 0 0 calc(var(--u) * -32);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 64);
}

.album-card__name,
.album-card__meta {
  display: block;
  min-height: calc(var(--font-size-s) * var(--line-height));
  overflow: hidden;
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.album-card__name {
  margin-top: calc(var(--u) * 14);
  font-weight: 600;
}

.album-card__meta {
  color: var(--color-text-muted);
}
</style>
