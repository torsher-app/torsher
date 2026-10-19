<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import FocusSection from '../components/FocusSection.vue'
import PosterCard from '../components/PosterCard.vue'
import { sampleTitles } from '../sampleTitles.ts'

const { t } = useI18n()
const router = useRouter()
const query = ref('')

const results = computed(() => {
  const needle = query.value.trim().toLowerCase()

  if (!needle)
    return sampleTitles

  return sampleTitles.filter(
    item =>
      item.title.toLowerCase().includes(needle)
      || item.originalTitle.toLowerCase().includes(needle),
  )
})
</script>

<template>
  <main>
    <h1 class="heading">
      {{ t("search.title") }}
    </h1>

    <FocusSection
      name="search-input"
      :edges="{ down: 'search-results' }"
      autofocus
    >
      <input
        v-model="query"
        v-focusable
        class="search-input"
        type="search"
        :placeholder="t('search.placeholder')"
      >
    </FocusSection>

    <FocusSection name="search-results" :edges="{ up: 'search-input' }">
      <div v-if="results.length > 0" class="grid">
        <PosterCard
          v-for="item in results"
          :key="item.id"
          :title="item"
          @select="router.push(`/title/${item.id}`)"
        />
      </div>
      <p v-else class="empty">
        {{ t("search.empty") }}
      </p>
    </FocusSection>
  </main>
</template>

<style scoped>
.heading {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-xl);
}

.search-input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
}

/* grid-gap, а не gap у flex: gap для flexbox появился только в Chromium 84 */
.grid {
  display: grid;
  grid-template-columns: repeat(6, var(--poster-width));
  grid-gap: var(--space-5) var(--space-4);
  margin-top: var(--space-5);
}

.empty {
  margin-top: var(--space-5);
  color: var(--color-text-muted);
}
</style>
