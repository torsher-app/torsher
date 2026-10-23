<script setup lang="ts">
import type { Hero } from '../composables/useHero.ts'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTitleMeta } from '../composables/useTitleMeta.ts'
import AppIcon from './AppIcon.vue'
import RatingList from './RatingList.vue'

const props = defineProps<{ hero: Hero }>()

const { t } = useI18n()
const { metaParts } = useTitleMeta()

// Логотип не загрузился — пишем название текстом
const logoFailed = ref(false)

watch(
  () => props.hero.details?.logo,
  () => {
    logoFailed.value = false
  },
)

const logo = computed(() =>
  logoFailed.value ? undefined : props.hero.details?.logo,
)

// Оценки ряда видны сразу, детали их только дополняют
const ratings = computed(
  () => props.hero.details?.ratings ?? props.hero.card.ratings ?? [],
)

const meta = computed(() => {
  const { card, details } = props.hero

  if (details)
    return metaParts(details)

  const parts = card.year ? [String(card.year)] : []

  parts.push(t(card.kind === 'movie' ? 'title.movie' : 'title.series'))

  return parts
})
</script>

<template>
  <!-- Новый тайтл проявляется после того, как старый погас: текст не наслаивается -->
  <Transition name="hero" mode="out-in">
    <div :key="hero.card.id" class="hero">
      <h1 class="hero__heading">
        <img
          v-if="logo"
          class="hero__logo"
          :src="logo"
          :alt="hero.card.title"
          decoding="async"
          @error="logoFailed = true"
        >
        <span v-else class="hero__title">{{ hero.card.title }}</span>
      </h1>
      <!-- Оценки первыми, строка всегда одна: длинные жанры уходят в многоточие,
           и высота hero не меняется от тайтла к тайтлу -->
      <div class="hero__meta">
        <RatingList
          v-if="ratings.length > 0"
          class="hero__rating"
          :ratings="ratings"
        />
        <span class="hero__parts">
          <span v-for="part in meta" :key="part" class="hero__part">{{
            part
          }}</span>
        </span>
      </div>
      <p v-if="hero.details?.overview" class="hero__overview">
        {{ hero.details.overview }}
      </p>
      <div class="hero__keys">
        <span class="hero__key">
          <span class="hero__button">OK</span>{{ t("home.hint.details") }}
        </span>
        <span class="hero__key">
          <span class="hero__button"><AppIcon name="play" /></span>{{ t("home.hint.watch") }}
        </span>
        <span class="hero__key">
          <span class="hero__button">OK</span>{{ t("home.hint.actions") }}
        </span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.hero {
  width: calc(var(--u) * 1000);
}

.hero-enter-active,
.hero-leave-active {
  transition: opacity var(--motion-base) var(--motion-easing);
}

.hero-enter-from,
.hero-leave-to {
  opacity: 0;
}

.hero__heading {
  margin: 0 0 calc(var(--u) * 22);
  font-size: var(--font-size-xl);
}

/* Логотипы бывают широкими и высокими: держим в рамке, прижав к левому нижнему углу */
.hero__logo {
  display: block;
  max-width: calc(var(--u) * 760);
  max-height: calc(var(--u) * 200);
  object-fit: contain;
  object-position: left bottom;
}

.hero__title {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--font-size-xl);
  font-weight: 700;
  line-height: 1.05;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.hero__meta {
  display: flex;
  align-items: center;
  max-width: calc(var(--u) * 900);
  margin-bottom: calc(var(--u) * 16);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  white-space: nowrap;
}

.hero__rating {
  flex: none;
}

/* Сжимается только мета: оценки видны всегда */
.hero__parts {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Точка-разделитель через margin: gap у flexbox нет в Chromium 68 */
.hero__rating + .hero__parts::before,
.hero__part + .hero__part::before {
  content: '';
  display: inline-block;
  width: calc(var(--u) * 5);
  height: calc(var(--u) * 5);
  margin: 0 calc(var(--u) * 14);
  border-radius: 50%;
  background: var(--color-text-dim);
  vertical-align: middle;
}

.hero__overview {
  display: -webkit-box;
  max-width: calc(var(--u) * 900);
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  line-height: 1.42;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.hero__keys {
  display: flex;
  margin-top: calc(var(--u) * 22);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
}

.hero__key {
  display: inline-flex;
  align-items: center;
  margin-right: calc(var(--u) * 26);
}

.hero__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: calc(var(--u) * 40);
  height: calc(var(--u) * 32);
  margin-right: calc(var(--u) * 10);
  padding: 0 calc(var(--u) * 8);
  border: calc(var(--u) * 2) solid var(--color-text-dim);
  border-radius: var(--radius-s);
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 17);
  font-weight: 600;
}
</style>
