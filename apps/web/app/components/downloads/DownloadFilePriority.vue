<script setup lang="ts">
import type { Torrent } from '@torsher/api-client'
import { ChevronDownIcon, ChevronUpIcon, DotIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type File = Torrent['files'][number]

const props = defineProps<{
  file: File
  modelValue: File['priority']
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [priority: File['priority']]
}>()
const { t } = useI18n()
const options = [
  { value: 'high', icon: ChevronUpIcon, label: 'panel.torrents.priorityHigh' },
  { value: 'medium', icon: DotIcon, label: 'panel.torrents.priorityMedium' },
  { value: 'low', icon: ChevronDownIcon, label: 'panel.torrents.priorityLow' },
] as const
const current = computed(() =>
  options.find(option => option.value === props.modelValue)!,
)
const label = computed(
  () =>
    `${t('panel.torrents.filePriority', { name: props.file.path })}: ${t(current.value.label)}`,
)

function update(value: unknown) {
  if (value === 'high' || value === 'medium' || value === 'low')
    emit('update:modelValue', value)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="size-7"
        :disabled="disabled"
        :aria-label="label"
        :title="label"
      >
        <component :is="current.icon" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup
        :model-value="modelValue"
        @update:model-value="update"
      >
        <DropdownMenuRadioItem
          v-for="option in options"
          :key="option.value"
          :value="option.value"
        >
          <component :is="option.icon" aria-hidden="true" />
          {{ t(option.label) }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
