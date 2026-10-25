<script setup lang="ts">
import type {
  ActivityKind,
  ActivityTab,
} from '~/composables/useFollowActivity'
import { useI18n } from 'vue-i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ACTIVITY_KINDS } from '~/composables/useFollowActivity'

defineProps<{
  counts: Partial<Record<ActivityTab, number>>
}>()

const { t } = useI18n()
const { tabs, tab, follow, kind } = useActivityQuery()
const { follows } = useFollows()

// `Select` не принимает пустую строку значением: «все» — свой ключ
const ALL = 'all'

const followModel = computed({
  get: () => follow.value || ALL,
  set: (value: string) => {
    follow.value = value === ALL ? '' : value
  },
})

const kindModel = computed({
  get: () => kind.value || ALL,
  set: (value: string) => {
    kind.value = value === ALL ? '' : (value as ActivityKind)
  },
})

const options = computed(() =>
  follows.value
    .map(item => ({ id: item.id, name: item.title ?? item.titleId }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)

// `SelectValue` запоминает текст пункта: при смене языка он остался бы старым
const followName = computed(() =>
  followModel.value === ALL
    ? t('panel.follow.activity.allTitles')
    : (options.value.find(item => item.id === followModel.value)?.name ?? ''),
)

// Повторный клик по выбранному чипу снимает выбор в ToggleGroup: остаёмся на нём
function onTab(value: unknown) {
  if (typeof value === 'string' && value)
    tab.value = value as ActivityTab
}
</script>

<template>
  <div
    class="no-scrollbar flex min-h-11 shrink-0 items-center gap-1 overflow-x-auto border-b py-1.5 pr-2.5 pl-3"
    role="toolbar"
    :aria-label="t('panel.follow.activity.filters')"
  >
    <ToggleGroup
      type="single"
      :spacing="1"
      :model-value="tab"
      class="shrink-0"
      :aria-label="t('panel.follow.activity.tabsLabel')"
      @update:model-value="onTab"
    >
      <ToggleGroupItem
        v-for="item in tabs"
        :key="item"
        :value="item"
        class="h-7 gap-1.5 border border-transparent px-2.5 text-[13px] font-normal text-muted-foreground hover:bg-transparent data-[state=on]:border-border data-[state=on]:bg-accent data-[state=on]:text-foreground"
      >
        {{ t(`panel.follow.activity.tabs.${item}`) }}
        <span
          v-if="counts[item] !== undefined"
          class="text-muted-foreground/70 tabular-nums"
        >{{ counts[item] }}</span>
      </ToggleGroupItem>
    </ToggleGroup>

    <div class="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
      <Select v-if="tab === 'history'" v-model="kindModel">
        <SelectTrigger
          size="sm"
          class="w-40 text-[13px] data-[size=sm]:h-7"
          :aria-label="t('panel.follow.activity.kind')"
        >
          <SelectValue>
            {{
              kindModel === ALL
                ? t("panel.follow.activity.allKinds")
                : t(`panel.follow.activity.kinds.${kindModel}`)
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="ALL">
            {{ t("panel.follow.activity.allKinds") }}
          </SelectItem>
          <SelectItem v-for="item in ACTIVITY_KINDS" :key="item" :value="item">
            {{ t(`panel.follow.activity.kinds.${item}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="followModel">
        <SelectTrigger
          size="sm"
          class="w-40 text-[13px] data-[size=sm]:h-7 sm:w-56"
          :aria-label="t('panel.follow.activity.titleFilter')"
        >
          <SelectValue>
            {{ followName }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="ALL">
            {{ t("panel.follow.activity.allTitles") }}
          </SelectItem>
          <SelectItem v-for="item in options" :key="item.id" :value="item.id">
            {{ item.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
