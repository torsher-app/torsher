<script setup lang="ts">
import { DownloadIcon, PlusIcon, RadarIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import AddIndexerDialog from './AddIndexerDialog.vue'
import ImportManagerDialog from './ImportManagerDialog.vue'
import IndexerItem from './IndexerItem.vue'
import ManagerItem from './ManagerItem.vue'
import SourcesSkeleton from './SourcesSkeleton.vue'

const { t } = useI18n()
const { indexers, managers, state, isEmpty, load, stopPolling } = useSources()

const isImportOpen = ref(false)
const isAddOpen = ref(false)

onMounted(load)
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="grid gap-6">
    <header
      class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div class="grid gap-1">
        <h1 class="text-xl font-semibold">
          {{ t("panel.sources.title") }}
        </h1>
        <p class="text-sm text-muted-foreground">
          {{ t("panel.sources.description") }}
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <Button @click="isImportOpen = true">
          <DownloadIcon aria-hidden="true" />
          {{ t("panel.sources.import") }}
        </Button>
        <Button variant="outline" @click="isAddOpen = true">
          <PlusIcon aria-hidden="true" />
          {{ t("panel.sources.add") }}
        </Button>
      </div>
    </header>

    <SourcesSkeleton v-if="state === 'loading'" />

    <section
      v-else-if="state === 'error'"
      class="grid justify-items-start gap-3 rounded-xl border p-4"
      role="alert"
    >
      <p class="text-sm">
        {{ t("panel.sources.loadError") }}
      </p>
      <Button variant="outline" size="sm" @click="load">
        {{ t("panel.common.retry") }}
      </Button>
    </section>

    <section
      v-else-if="isEmpty"
      class="grid justify-items-center gap-3 rounded-xl border border-dashed px-4 py-12 text-center"
    >
      <RadarIcon class="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 class="font-medium">
        {{ t("panel.sources.empty.title") }}
      </h2>
      <p class="max-w-sm text-sm text-muted-foreground">
        {{ t("panel.sources.empty.text") }}
      </p>
      <Button class="mt-2" @click="isImportOpen = true">
        {{ t("panel.sources.import") }}
      </Button>
    </section>

    <template v-else>
      <section v-if="managers.length > 0" class="grid gap-3">
        <h2 class="font-medium">
          {{ t("panel.sources.managers.title") }}
        </h2>
        <ul class="divide-y rounded-xl border">
          <ManagerItem
            v-for="manager in managers"
            :key="manager.id"
            :manager="manager"
          />
        </ul>
      </section>

      <section v-if="indexers.length > 0" class="grid gap-3">
        <h2 class="font-medium">
          {{ t("panel.sources.indexers.title") }}
        </h2>
        <ul class="divide-y rounded-xl border">
          <IndexerItem
            v-for="indexer in indexers"
            :key="indexer.id"
            :indexer="indexer"
          />
        </ul>
      </section>
    </template>

    <ImportManagerDialog v-model:open="isImportOpen" />
    <AddIndexerDialog v-model:open="isAddOpen" />
  </div>
</template>
