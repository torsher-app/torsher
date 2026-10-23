<script setup lang="ts">
import type { HistoryEntry } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { formatDateTime, formatRelative } from '~/lib/format'

const props = defineProps<{
  entry: HistoryEntry
  now: number
}>()

const { t, locale } = useI18n()

// «S2E5 · осталось 23 мин», у фильма — «Фильм · досмотрено»
const meta = computed(() => {
  const { entry } = props
  const what
    = entry.season !== null && entry.episode !== null
      ? `S${entry.season}E${entry.episode}`
      : t(`panel.history.kinds.${entry.title.kind}`)
  const left = entry.duration
    ? Math.round((entry.duration - entry.position) / 60)
    : 0
  const state
    = entry.watched || !left
      ? t('panel.history.watched')
      : t('panel.history.left', { n: left })

  return `${what} · ${state}`
})
</script>

<template>
  <li class="flex h-14 items-center gap-3 border-b pr-3 pl-4 text-[13.5px]">
    <span class="h-10 w-7 shrink-0 overflow-hidden rounded-sm bg-muted">
      <img
        v-if="entry.title.poster"
        :src="entry.title.poster"
        alt=""
        class="size-full object-cover"
        loading="lazy"
        decoding="async"
      >
    </span>
    <span class="grid min-w-0 flex-1">
      <span class="truncate font-medium">{{ entry.title.title }}</span>
      <span class="truncate text-[12.5px] text-muted-foreground">{{
        meta
      }}</span>
    </span>
    <span
      class="shrink-0 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums"
      :title="formatDateTime(entry.watchedAt, locale)"
    >
      {{ formatRelative(entry.watchedAt, locale, now) }}
    </span>
  </li>
</template>
