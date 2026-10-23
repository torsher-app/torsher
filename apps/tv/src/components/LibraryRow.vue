<script setup lang="ts">
import type { LibraryFile } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import AppIcon from './AppIcon.vue'

/**
 * Первая строка «Источников», когда тайтл есть в библиотеке: файл с диска
 * сервера, без поиска раздач и пиров. Та же сетка, что у строки раздачи.
 */
const props = defineProps<{
  files: LibraryFile[]
}>()

const emit = defineEmits<{ select: [] }>()

const { t } = useI18n()
const { sizeLabel } = useSourceLabels()

// Серии по сезонам: «S1 · 1–8», у фильма — ничего
const coverage = computed(() => {
  const seasons = Array.from(
    new Set(props.files.map(file => file.season).filter(Boolean)),
  ) as number[]

  if (seasons.length === 0)
    return ''

  if (seasons.length > 1)
    return `S${Math.min(...seasons)}–${Math.max(...seasons)}`

  const episodes = props.files.map(file => file.episode ?? 0)

  return `S${seasons[0]} · ${Math.min(...episodes)}–${Math.max(
    ...props.files.map(file => file.episodeTo ?? file.episode ?? 0),
  )}`
})

const qualities = computed(() =>
  Array.from(new Set(props.files.map(file => file.quality).filter(Boolean))),
)

const size = computed(() =>
  sizeLabel(props.files.reduce((sum, file) => sum + file.size, 0)),
)
</script>

<template>
  <button v-focusable class="library-row" type="button" @click="emit('select')">
    <span class="library-row__lead">
      <span class="library-row__title">
        <AppIcon name="library" class="library-row__icon" />
        {{ t("download.state.library") }}
      </span>
      <span class="library-row__dim">{{ t("sources.libraryHint") }}</span>
    </span>
    <span class="library-row__body">
      <span class="library-row__badges">
        <span v-if="coverage" class="library-row__badge">{{ coverage }}</span>
        <span
          v-for="quality in qualities"
          :key="quality ?? ''"
          class="library-row__badge"
        >{{ quality }}</span>
      </span>
      <span class="library-row__dim">
        {{ t("download.files", files.length) }}
      </span>
    </span>
    <span class="library-row__side">
      <span class="library-row__size">{{ size }}</span>
      <span class="library-row__dim">{{ t("sources.libraryPlay") }}</span>
    </span>
  </button>
</template>

<style scoped>
/* Сетка и фокус — как у строки раздачи (`SourceRow`): список не меняет ритм */
.library-row {
  display: grid;
  grid-template-columns: calc(var(--u) * 360) 1fr calc(var(--u) * 300);
  grid-column-gap: calc(var(--u) * 32);
  align-items: center;
  width: 100%;
  margin-bottom: var(--space-1);
  padding: calc(var(--u) * 22) calc(var(--u) * 28);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  transition: transform var(--motion-base) var(--motion-easing);
}

.library-row:focus {
  --bump-scale: 1.02;

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.library-row__lead,
.library-row__body,
.library-row__side {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.library-row__side {
  align-items: flex-end;
  text-align: right;
}

.library-row__title {
  display: flex;
  align-items: center;
  color: var(--color-ok);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.library-row__icon {
  margin-right: calc(var(--u) * 10);
}

.library-row__dim {
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
}

.library-row__badges {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: calc(var(--u) * 8);
}

.library-row__badge {
  margin: 0 calc(var(--u) * 10) calc(var(--u) * 4) 0;
  padding: calc(var(--u) * 2) calc(var(--u) * 12);
  border: calc(var(--u) * 2) solid var(--color-line);
  border-radius: var(--radius-s);
  font-size: calc(var(--u) * 20);
  font-weight: 600;
}

.library-row__size {
  font-size: var(--font-size-m);
  font-variant-numeric: tabular-nums;
}

.library-row:focus .library-row__title,
.library-row:focus .library-row__dim {
  color: var(--color-bg);
}
</style>
