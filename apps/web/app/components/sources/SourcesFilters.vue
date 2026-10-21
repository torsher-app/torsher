<script setup lang="ts">
import type { SourcesFilter } from '~/composables/useSources'
import { RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const { t } = useI18n()
const { checkRun, checkAll } = useSources()
const { filter, search, counts } = useSourcesList()

const FILTERS: SourcesFilter[] = ['all', 'attention', 'disabled']

// Повторный клик по выбранному чипу снимает выбор в ToggleGroup: остаёмся на нём
function onFilter(value: unknown) {
  if (typeof value === 'string' && value)
    filter.value = value as SourcesFilter
}

async function onCheckAll() {
  const result = await checkAll()

  if (result) {
    toast.success(t('panel.sources.checkAll.done'), {
      description: t('panel.sources.checkAll.result', result),
    })
  }
}
</script>

<template>
  <div
    class="no-scrollbar flex min-h-11 shrink-0 items-center gap-1 overflow-x-auto border-b py-1.5 pr-2.5 pl-3"
    role="toolbar"
    :aria-label="t('panel.sources.filters.label')"
  >
    <ToggleGroup
      type="single"
      :spacing="1"
      :model-value="filter"
      class="shrink-0"
      @update:model-value="onFilter"
    >
      <ToggleGroupItem
        v-for="item in FILTERS"
        :key="item"
        :value="item"
        class="h-7 gap-1.5 border border-transparent px-2.5 text-[13px] font-normal text-muted-foreground hover:bg-transparent data-[state=on]:border-border data-[state=on]:bg-accent data-[state=on]:text-foreground"
      >
        {{ t(`panel.sources.filters.${item}`) }}
        <span class="text-muted-foreground/70 tabular-nums">{{
          counts[item]
        }}</span>
      </ToggleGroupItem>
    </ToggleGroup>

    <div class="relative ml-auto w-36 shrink-0 sm:w-56">
      <SearchIcon
        class="pointer-events-none absolute top-1.5 left-2.5 size-4 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        v-model="search"
        type="search"
        autocomplete="off"
        class="h-7 pl-8 text-[13px] md:text-[13px]"
        :placeholder="t('panel.sources.filters.searchPlaceholder')"
        :aria-label="t('panel.sources.filters.search')"
      />
    </div>
    <Button
      variant="ghost"
      size="sm"
      class="h-7 shrink-0"
      :disabled="!!checkRun || counts.all === 0"
      :aria-label="t('panel.sources.checkAll.action')"
      @click="onCheckAll"
    >
      <RefreshCwIcon aria-hidden="true" />
      <span class="hidden md:inline">{{
        t("panel.sources.checkAll.action")
      }}</span>
    </Button>
  </div>
</template>
