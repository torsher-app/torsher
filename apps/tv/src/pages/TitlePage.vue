<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import FocusSection from '../components/FocusSection.vue'
import { sampleTitles } from '../sampleTitles.ts'

const props = defineProps<{ id: string }>()

const { t } = useI18n()

const title = computed(() => sampleTitles.find(item => item.id === props.id))
</script>

<template>
  <main v-if="title" class="title" :style="{ backgroundColor: title.color }">
    <div class="title__content">
      <h1 class="title__name">
        {{ title.title }}
      </h1>
      <p class="title__meta">
        {{ title.year }} ·
        {{ t(title.kind === "movie" ? "title.movie" : "title.series") }} ·
        {{ title.originalTitle }}
      </p>
      <p class="title__overview">
        {{ title.overview }}
      </p>

      <FocusSection name="title-actions" class="title__actions" autofocus>
        <button v-focusable class="action action--primary" type="button">
          {{ t("title.watch") }}
        </button>
        <button v-focusable class="action" type="button">
          {{ t("title.sources") }}
        </button>
      </FocusSection>
    </div>
  </main>

  <p v-else>
    {{ t("title.notFound") }}
  </p>
</template>

<style scoped>
/* Отрицательные отступы растягивают фон на весь экран поверх safe area #app */
.title {
  min-height: 100%;
  margin: calc(var(--safe-y) * -1) calc(var(--safe-x) * -1);
  padding: var(--safe-y) var(--safe-x);
  background-image: linear-gradient(90deg, var(--color-bg) 35%, transparent);
}

.title__content {
  max-width: calc(var(--u) * 900);
}

.title__name {
  margin: var(--space-6) 0 var(--space-2);
  font-size: var(--font-size-xl);
}

.title__meta {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
}

.title__overview {
  margin: 0 0 var(--space-5);
}

.action {
  margin-right: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}

.action--primary {
  background: var(--color-accent);
  color: var(--color-bg);
}
</style>
