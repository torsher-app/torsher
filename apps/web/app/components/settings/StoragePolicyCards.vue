<script setup lang="ts">
import type { StorageOverview } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { formatBytes } from '~/lib/format'
import StorageSizeCard from './StorageSizeCard.vue'

/** Лимит кэша и запас места: одни карточки в «Хранилище» и в мастере */
const props = defineProps<{
  overview: StorageOverview
}>()

const { t, locale } = useI18n()

const cachePercent = computed(() =>
  props.overview.policy.cacheLimit > 0
    ? Math.round(
        (props.overview.cacheUsed / props.overview.policy.cacheLimit) * 100,
      )
    : 0,
)
</script>

<template>
  <StorageSizeCard
    field="cacheLimit"
    :value="overview.policy.cacheLimit"
    :title="t('panel.settings.storage.cacheTitle')"
    :description="t('panel.settings.storage.cacheText')"
    :saved-title="t('panel.settings.storage.cacheSaved')"
  >
    <template #hint>
      {{
        t("panel.settings.storage.cacheHint", {
          used: formatBytes(overview.cacheUsed, locale),
          percent: cachePercent,
        })
      }}
      <template v-if="!overview.policy.custom">
        {{ t("panel.settings.storage.defaults") }}
      </template>
    </template>
  </StorageSizeCard>

  <StorageSizeCard
    field="minFree"
    :value="overview.policy.minFree"
    :title="t('panel.settings.storage.reserveTitle')"
    :description="t('panel.settings.storage.reserveText')"
    :saved-title="t('panel.settings.storage.reserveSaved')"
  >
    <template #hint>
      {{ t("panel.settings.storage.reserveHint") }}
    </template>
  </StorageSizeCard>
</template>
