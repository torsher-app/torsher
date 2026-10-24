<script setup lang="ts">
import type { RestoreOutcome } from '~/composables/useRestoreFlow'
import { FileDownIcon, FileUpIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import SettingsCard from './SettingsCard.vue'
import TransferExportDialog from './TransferExportDialog.vue'
import TransferImportDialog from './TransferImportDialog.vue'

/**
 * Перенос данных между серверами: экспорт в файл и импорт файла с другого
 * сервера. В отличие от копии, импорт сливает данные с тем, что уже есть.
 */
const emit = defineEmits<{
  restored: [outcome: Extract<RestoreOutcome, { kind: 'finished' }>]
}>()

const { t } = useI18n()

const base = 'panel.transfer'
const exportOpen = ref(false)
const importOpen = ref(false)
</script>

<template>
  <SettingsCard :title="t(`${base}.title`)" :description="t(`${base}.text`)">
    <template #hint>
      {{ t(`${base}.hint`) }}
    </template>
    <template #action>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" @click="exportOpen = true">
          <FileDownIcon aria-hidden="true" />
          {{ t(`${base}.exportAction`) }}
        </Button>
        <Button variant="outline" @click="importOpen = true">
          <FileUpIcon aria-hidden="true" />
          {{ t(`${base}.importAction`) }}
        </Button>
      </div>
    </template>

    <TransferExportDialog v-model:open="exportOpen" />
    <TransferImportDialog
      v-model:open="importOpen"
      @restored="emit('restored', $event)"
    />
  </SettingsCard>
</template>
