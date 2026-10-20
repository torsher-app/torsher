<script setup lang="ts">
import { onActivated, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import FocusSection from '../components/FocusSection.vue'
import PosterCard from '../components/PosterCard.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import ScreenState from '../components/ScreenState.vue'
import { useCatalogSearch } from '../composables/useCatalogSearch.ts'
import { useFocus } from '../focus/index.ts'

defineOptions({ name: 'SearchPage' })

// Две строки сетки: столько видно на экране без прокрутки
const SKELETON_COUNT = 12

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const query = ref('')

const { status, items, error, retry } = useCatalogSearch(query)

// Возврат из карточки: фокус на ту карточку, с которой ушли
onActivated(() => {
  if (!focus.activate('search-results'))
    focus.activate('search-input')
})
</script>

<template>
  <main>
    <header class="header">
      <h1 class="heading">
        {{ t("search.title") }}
      </h1>
      <FocusSection name="search-menu" :edges="{ down: 'search-input' }">
        <button
          v-focusable
          class="action"
          type="button"
          @click="router.push('/about')"
        >
          {{ t("common.about") }}
        </button>
      </FocusSection>
    </header>

    <FocusSection
      name="search-input"
      :edges="{ up: 'search-menu', down: 'search-results' }"
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
      <ScreenState
        v-if="status === 'error' && error"
        :kind="error"
        @retry="retry"
      />
      <div v-else-if="items.length > 0" class="grid">
        <PosterCard
          v-for="item in items"
          :key="item.id"
          :card="item"
          @select="router.push(`/title/${item.id}`)"
        />
      </div>
      <div v-else-if="status === 'loading'" class="grid">
        <PosterSkeleton v-for="index in SKELETON_COUNT" :key="index" />
      </div>
      <ScreenState v-else-if="status === 'ready'" kind="empty" />
      <p v-else class="hint">
        {{ t("search.hint") }}
      </p>
    </FocusSection>
  </main>
</template>

<style scoped>
/* Без gap у flexbox: его нет в Chromium 68 */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.heading {
  margin: 0;
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

.hint {
  margin-top: var(--space-5);
  color: var(--color-text-muted);
}
</style>
