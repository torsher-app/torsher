<script setup lang="ts">
import type { ExternalListPreview } from '~/lib/externalLists'
import { useI18n } from 'vue-i18n'
import { externalListsKey as base } from '~/lib/externalLists'

defineProps<{
  preview: ExternalListPreview
  profileName: string
}>()

const { t } = useI18n()
</script>

<template>
  <section class="grid gap-3 rounded-lg border bg-muted/30 p-4">
    <div class="grid gap-1">
      <h3 class="font-semibold">
        {{ t(`${base}.previewTitle`) }}
      </h3>
      <p class="break-words font-medium">
        {{ preview.name }} · {{ profileName }}
      </p>
    </div>
    <dl class="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
      <div
        v-for="(value, key) in preview.counts"
        :key="key"
        class="flex justify-between gap-2"
      >
        <dt class="text-muted-foreground">
          {{ t(`${base}.counts.${key}`) }}
        </dt>
        <dd class="tabular-nums">
          {{ value }}
        </dd>
      </div>
    </dl>
    <ul
      v-if="preview.items.length"
      class="max-h-36 list-inside list-disc overflow-y-auto break-words text-sm"
    >
      <li v-for="item in preview.items" :key="item.titleId">
        {{ item.title }}
      </li>
    </ul>
    <p class="text-sm text-muted-foreground">
      {{ t(`${base}.previewText`) }}
    </p>
  </section>
</template>
