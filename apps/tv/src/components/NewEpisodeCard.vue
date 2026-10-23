<script setup lang="ts">
import type { EpisodeCard } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { formatAirDate } from '../lib/titleInfo.ts'
import { openTitleActions } from '../titleActions.ts'

/** Новая серия в ряду главной: кадр 16:9, сериал и что вышло */
const props = withDefaults(
  defineProps<{ episode: EpisodeCard, loadImage?: boolean }>(),
  { loadImage: true },
)

defineEmits<{ select: [] }>()

const { t } = useI18n()
const language = useCatalogLanguage()

const code = computed(
  () => `S${props.episode.season}E${props.episode.episode}`,
)

const meta = computed(() => {
  const { newCount, airDate } = props.episode

  if (newCount > 1)
    return t('home.newEpisodes.count', newCount)

  return airDate
    ? t('home.newEpisodes.aired', {
        date: formatAirDate(airDate, language.value),
      })
    : ''
})

function openActions() {
  openTitleActions({
    id: props.episode.titleId,
    title: props.episode.title,
    kind: 'series',
  })
}
</script>

<template>
  <button
    v-focusable
    class="card new-episode"
    type="button"
    data-long-press
    @click="$emit('select')"
    @longpress="openActions"
  >
    <span class="new-episode__frame">
      <img
        v-if="episode.image && loadImage"
        class="new-episode__image"
        :src="episode.image"
        alt=""
        decoding="async"
      >
      <span class="new-episode__code">{{ code }}</span>
      <span class="card__ring" />
    </span>
    <span class="new-episode__title">{{ episode.title }}</span>
    <span class="new-episode__meta">
      {{ episode.episodeTitle ? `${episode.episodeTitle} · ${meta}` : meta }}
    </span>
  </button>
</template>

<style scoped>
.new-episode {
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
.new-episode__frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.new-episode__image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
  object-fit: cover;
}

.new-episode__code {
  position: absolute;
  bottom: calc(var(--u) * 12);
  left: calc(var(--u) * 12);
  display: flex;
  align-items: center;
  height: calc(var(--u) * 36);
  padding: 0 calc(var(--u) * 12);
  border-radius: calc(var(--u) * 18);
  background: var(--color-accent);
  color: var(--color-accent-ink);
  font-size: calc(var(--u) * 22);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.new-episode__title,
.new-episode__meta {
  display: block;
  min-height: calc(var(--font-size-s) * var(--line-height));
  overflow: hidden;
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.new-episode__title {
  margin-top: calc(var(--u) * 14);
  font-weight: 600;
}

.new-episode__meta {
  color: var(--color-text-muted);
}
</style>
