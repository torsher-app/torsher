<script setup lang="ts">
import type { TitleRating } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'

// Поставщиков клиент не знает: рисует пришедшие оценки в порядке сервера
defineProps<{ ratings: TitleRating[] }>()

const { t } = useI18n()
</script>

<template>
  <span class="ratings">
    <span
      v-for="rating in ratings"
      :key="rating.provider"
      class="ratings__item"
    >{{
      t("title.ratingValue", {
        label: rating.label,
        value: rating.value.toFixed(1),
      })
    }}</span>
  </span>
</template>

<style scoped>
.ratings {
  color: var(--color-text);
  font-weight: 600;
  white-space: nowrap;
}

/* Отступ через margin: gap у flexbox нет в Chromium 68 */
.ratings__item + .ratings__item {
  margin-left: calc(var(--u) * 24);
}
</style>
