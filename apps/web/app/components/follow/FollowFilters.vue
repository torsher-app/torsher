<script setup lang="ts">
import type { FollowsFilter } from '~/composables/useFollows'
import { SearchIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const { t } = useI18n()
const { filters, filter, search, counts } = useFollowsList()

// Повторный клик по выбранному чипу снимает выбор в ToggleGroup: остаёмся на нём
function onFilter(value: unknown) {
  if (typeof value === 'string' && value)
    filter.value = value as FollowsFilter
}
</script>

<template>
  <div
    class="no-scrollbar flex min-h-11 shrink-0 items-center gap-1 overflow-x-auto border-b py-1.5 pr-2.5 pl-3"
    role="toolbar"
    :aria-label="t('panel.follow.filters.label')"
  >
    <ToggleGroup
      type="single"
      :spacing="1"
      :model-value="filter"
      class="shrink-0"
      @update:model-value="onFilter"
    >
      <ToggleGroupItem
        v-for="item in filters"
        :key="item"
        :value="item"
        class="h-7 gap-1.5 border border-transparent px-2.5 text-[13px] font-normal text-muted-foreground hover:bg-transparent data-[state=on]:border-border data-[state=on]:bg-accent data-[state=on]:text-foreground"
      >
        {{ t(`panel.follow.filters.${item}`) }}
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
        :placeholder="t('panel.follow.filters.searchPlaceholder')"
        :aria-label="t('panel.follow.filters.search')"
      />
    </div>
  </div>
</template>
