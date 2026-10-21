<script setup lang="ts">
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import StorageDiskCard from '~/components/settings/StorageDiskCard.vue'
import StorageQueueCard from '~/components/settings/StorageQueueCard.vue'
import StorageSizeCard from '~/components/settings/StorageSizeCard.vue'
import { formatBytes } from '~/lib/format'

definePageMeta({
  middleware: 'required-auth',
})

const { t, locale } = useI18n()
const { overview, state, load } = useStorage()

const cachePercent = computed(() => {
  const value = overview.value

  return value && value.policy.cacheLimit > 0
    ? Math.round((value.cacheUsed / value.policy.cacheLimit) * 100)
    : 0
})

onMounted(load)
</script>

<template>
  <div class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("panel.settings.nav.storage") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("panel.settings.storage.description") }}
      </p>
    </header>

    <!-- Скелетон повторяет карточки тома и настроек -->
    <div
      v-if="state === 'loading' || state === 'idle'"
      class="grid gap-5"
      aria-busy="true"
    >
      <Skeleton class="h-36 rounded-xl" />
      <Skeleton class="h-48 rounded-xl" />
      <Skeleton class="h-48 rounded-xl" />
    </div>

    <section
      v-else-if="state === 'error' || !overview"
      class="grid justify-items-center gap-3.5 rounded-xl border px-4 py-10 text-center"
      role="alert"
    >
      <div
        class="grid size-11 place-items-center rounded-xl border bg-muted text-destructive"
        aria-hidden="true"
      >
        <CircleAlertIcon class="size-5" />
      </div>
      <h2 class="text-base font-semibold">
        {{ t("panel.settings.storage.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.settings.storage.loadErrorText") }}
      </p>
      <Button variant="outline" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <template v-else>
      <StorageDiskCard :overview="overview" />

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

      <StorageQueueCard :queue="overview.queue" />
    </template>
  </div>
</template>
