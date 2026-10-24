<script setup lang="ts">
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import StorageDiskCard from '~/components/settings/StorageDiskCard.vue'
import StorageFoldersCard from '~/components/settings/StorageFoldersCard.vue'
import StorageLibraryCard from '~/components/settings/StorageLibraryCard.vue'
import StorageQueueCard from '~/components/settings/StorageQueueCard.vue'
import StoragePolicyCards from '~/components/settings/StoragePolicyCards.vue'

definePageMeta({
  middleware: 'required-auth',
})

const { t } = useI18n()
const { overview, state, load } = useStorage()

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
      <Skeleton class="h-64 rounded-xl" />
      <Skeleton class="h-36 rounded-xl" />
      <Skeleton class="h-40 rounded-xl" />
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
      <StorageFoldersCard :overview="overview" />

      <StorageDiskCard :overview="overview" />

      <StorageLibraryCard :library="overview.library" />

      <StoragePolicyCards :overview="overview" />

      <StorageQueueCard :queue="overview.queue" />
    </template>
  </div>
</template>
