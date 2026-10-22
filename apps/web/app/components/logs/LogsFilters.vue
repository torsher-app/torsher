<script setup lang="ts">
import type { LogsLevelFilter } from '~/lib/logs'
import { PauseIcon, PlayIcon, SearchIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  isLogSource,
  LEVEL_FILTERS,
  LOG_SOURCES,
  logSourceLabels,
} from '~/lib/logs'

const { t } = useI18n()
const { levelFilter, source, search, counts, isPaused, setPaused } = useLogs()

// В Select нет пустого значения: «Все источники» — отдельный пункт
const ALL_SOURCES = 'all'

const sourceValue = computed({
  get: () => source.value ?? ALL_SOURCES,
  set: (value: string) => {
    source.value = isLogSource(value) ? value : null
  },
})

// Повторный клик по выбранному чипу снимает выбор в ToggleGroup: остаёмся на нём
function onLevel(value: unknown) {
  if (typeof value === 'string' && value)
    levelFilter.value = value as LogsLevelFilter
}
</script>

<template>
  <div
    class="no-scrollbar flex min-h-11 shrink-0 items-center gap-1 overflow-x-auto border-b py-1.5 pr-2.5 pl-3"
    role="toolbar"
    :aria-label="t('panel.logs.filters.label')"
  >
    <ToggleGroup
      type="single"
      :spacing="1"
      :model-value="levelFilter"
      class="shrink-0"
      @update:model-value="onLevel"
    >
      <ToggleGroupItem
        v-for="item in LEVEL_FILTERS"
        :key="item"
        :value="item"
        class="h-7 gap-1.5 border border-transparent px-2.5 text-[13px] font-normal text-muted-foreground hover:bg-transparent data-[state=on]:border-border data-[state=on]:bg-accent data-[state=on]:text-foreground"
      >
        {{ t(`panel.logs.filters.${item}`) }}
        <span
          v-if="counts[item] !== undefined"
          class="text-muted-foreground/70 tabular-nums"
        >{{ counts[item] }}</span>
      </ToggleGroupItem>
    </ToggleGroup>

    <Select v-model="sourceValue">
      <SelectTrigger
        size="sm"
        class="ml-1 w-40 shrink-0 text-[13px] data-[size=sm]:h-7"
        :aria-label="t('panel.logs.filters.source')"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="ALL_SOURCES">
          {{ t("panel.logs.filters.allSources") }}
        </SelectItem>
        <SelectItem v-for="item in LOG_SOURCES" :key="item" :value="item">
          {{ t(logSourceLabels[item]) }}
        </SelectItem>
      </SelectContent>
    </Select>

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
        :placeholder="t('panel.logs.filters.searchPlaceholder')"
        :aria-label="t('panel.logs.filters.search')"
      />
    </div>
    <Button
      variant="ghost"
      size="sm"
      class="h-7 shrink-0 md:w-32 md:justify-start"
      :aria-label="
        t(
          isPaused
            ? 'panel.logs.filters.resumeLabel'
            : 'panel.logs.filters.pauseLabel',
        )
      "
      :aria-pressed="isPaused"
      @click="setPaused(!isPaused)"
    >
      <component :is="isPaused ? PlayIcon : PauseIcon" aria-hidden="true" />
      <span class="hidden md:inline">{{
        t(isPaused ? "panel.logs.filters.resume" : "panel.logs.filters.pause")
      }}</span>
    </Button>
  </div>
</template>
