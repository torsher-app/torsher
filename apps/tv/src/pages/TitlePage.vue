<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import FocusSection from '../components/FocusSection.vue'
import ScreenState from '../components/ScreenState.vue'
import { useCatalogTitle } from '../composables/useCatalogTitle.ts'

const props = defineProps<{ id: string }>()

const MAX_GENRES = 3

const { t } = useI18n()

const { status, title, error, retry } = useCatalogTitle(
  computed(() => props.id),
)

function formatRuntime(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  return hours > 0
    ? t('title.runtime', { hours, minutes: rest })
    : t('title.runtimeMinutes', { minutes: rest })
}

// Год · тип · длительность или число сезонов · рейтинг · жанры
const meta = computed(() => {
  const value = title.value

  if (!value)
    return ''

  const parts: string[] = []

  if (value.year)
    parts.push(String(value.year))

  parts.push(t(value.kind === 'movie' ? 'title.movie' : 'title.series'))

  if (value.runtime)
    parts.push(formatRuntime(value.runtime))

  if (value.seasons?.length)
    parts.push(t('title.seasonCount', value.seasons.length))

  if (value.rating)
    parts.push(t('title.rating', { rating: value.rating.toFixed(1) }))

  if (value.genres.length > 0)
    parts.push(value.genres.slice(0, MAX_GENRES).join(', '))

  return parts.join(' · ')
})

const seasons = computed(() => title.value?.seasons ?? [])

function seasonMeta(season: { year?: number, episodeCount: number }) {
  const episodes = t('title.episodeCount', season.episodeCount)

  return season.year ? `${season.year} · ${episodes}` : episodes
}
</script>

<template>
  <main class="title">
    <img
      v-if="title?.backdrop"
      class="title__backdrop"
      :src="title.backdrop"
      alt=""
      decoding="async"
    >
    <div class="title__shade" />

    <FocusSection
      v-if="status === 'error' && error"
      name="title-state"
      class="title__content"
      autofocus
    >
      <ScreenState :kind="error" @retry="retry" />
    </FocusSection>

    <div v-else-if="title" class="title__content">
      <div class="title__hero">
        <div class="title__poster">
          <img
            v-if="title.poster"
            class="title__poster-image"
            :src="title.poster"
            alt=""
            decoding="async"
          >
        </div>

        <div class="title__info">
          <h1 class="title__name">
            {{ title.title }}
          </h1>
          <p
            v-if="title.originalTitle && title.originalTitle !== title.title"
            class="title__original"
          >
            {{ title.originalTitle }}
          </p>
          <p class="title__meta">
            {{ meta }}
          </p>
          <p v-if="title.overview" class="title__overview">
            {{ title.overview }}
          </p>

          <FocusSection
            name="title-actions"
            :edges="{ down: 'title-seasons' }"
            autofocus
          >
            <button v-focusable class="action action--primary" type="button">
              {{ t("title.watch") }}
            </button>
            <button v-focusable class="action" type="button">
              {{ t("title.sources") }}
            </button>
          </FocusSection>
        </div>
      </div>

      <section v-if="seasons.length > 0" class="seasons">
        <h2 class="seasons__heading">
          {{ t("title.seasons") }}
        </h2>
        <FocusSection
          name="title-seasons"
          class="seasons__row"
          :edges="{ up: 'title-actions' }"
        >
          <button
            v-for="season in seasons"
            :key="season.number"
            v-focusable
            class="season"
            type="button"
          >
            <span class="season__name">{{ season.name }}</span>
            <span class="season__meta">{{ seasonMeta(season) }}</span>
          </button>
        </FocusSection>
      </section>
    </div>

    <div v-else class="title__content title__hero" aria-hidden="true">
      <div class="title__poster skeleton" />
      <div class="title__info">
        <div class="skeleton-line skeleton-line--name skeleton" />
        <div class="skeleton-line skeleton" />
        <div class="skeleton-line skeleton-line--wide skeleton" />
        <div class="skeleton-line skeleton-line--wide skeleton" />
      </div>
    </div>
  </main>
</template>

<style scoped>
/* Свой полноэкранный скроллер: карточка всегда открывается с начала, фон — под safe area */
.title {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: var(--safe-y) var(--safe-x);
}

.title__backdrop,
.title__shade {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: calc(var(--u) * 1080);
}

.title__backdrop {
  object-fit: cover;
}

.title__shade {
  background-image:
    linear-gradient(90deg, var(--color-bg) 20%, transparent 75%),
    linear-gradient(0deg, var(--color-bg) 0%, transparent 50%);
}

.title__content {
  position: relative;
}

.title__hero {
  display: flex;
  align-items: flex-start;
  margin-top: var(--space-6);
}

/* flex-shrink: 0 вместо gap — gap у flexbox нет в Chromium 68 */
.title__poster {
  position: relative;
  flex-shrink: 0;
  width: calc(var(--u) * 300);
  height: calc(var(--u) * 450);
  margin-right: var(--space-5);
  overflow: hidden;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.title__poster-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.title__info {
  max-width: calc(var(--u) * 1000);
}

.title__name {
  margin: 0;
  font-size: var(--font-size-xl);
}

.title__original {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
}

.title__meta {
  margin: var(--space-2) 0 var(--space-3);
  color: var(--color-text-muted);
}

/* Длинное описание обрезаем: -webkit-line-clamp работает и в Chromium 68 */
.title__overview {
  display: -webkit-box;
  margin: 0 0 var(--space-5);
  overflow: hidden;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}

.seasons {
  margin-top: var(--space-6);
}

.seasons__heading {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-l);
}

/* Ряд прокручивает движок фокуса (scrollIntoView); отступы оставляют место для кольца и масштаба */
.seasons__row {
  display: flex;
  margin: 0 calc(var(--space-3) * -1);
  padding: var(--space-3);
  overflow: hidden;
}

.season {
  flex-shrink: 0;
  width: calc(var(--u) * 320);
  margin-right: var(--space-3);
  padding: var(--space-3);
  border: 0;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.season__name,
.season__meta {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.season__meta {
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.skeleton-line {
  width: calc(var(--u) * 400);
  height: var(--font-size-m);
  margin-bottom: var(--space-3);
  border-radius: var(--radius-s);
}

.skeleton-line--name {
  width: calc(var(--u) * 600);
  height: var(--font-size-xl);
}

.skeleton-line--wide {
  width: calc(var(--u) * 900);
}
</style>
