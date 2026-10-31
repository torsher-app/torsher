<script setup lang="ts">
import type { Torrent } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type File = Torrent['files'][number]

defineProps<{ file: File, disabled?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [priority: File['priority']]
}>()
const { t } = useI18n()

function update(value: unknown) {
  if (value === 'high' || value === 'medium' || value === 'low')
    emit('update:modelValue', value)
}
</script>

<template>
  <div>
    <Select
      :model-value="file.priority"
      :disabled="disabled"
      @update:model-value="update"
    >
      <SelectTrigger
        size="sm"
        class="w-28"
        :aria-label="t('panel.torrents.filePriority', { name: file.path })"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="high">
          {{ t("panel.torrents.priorityHigh") }}
        </SelectItem>
        <SelectItem value="medium">
          {{ t("panel.torrents.priorityMedium") }}
        </SelectItem>
        <SelectItem value="low">
          {{ t("panel.torrents.priorityLow") }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
