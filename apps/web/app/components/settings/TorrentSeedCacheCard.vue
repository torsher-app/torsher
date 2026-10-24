<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import SettingsCard from './SettingsCard.vue'

defineProps<{
  value: boolean
}>()

const { t } = useI18n()
const { save } = useTorrentSettings()

const isSaving = ref(false)

// Переключатель без формы сохраняется сразу, как оценки IMDb
async function onToggle(seedCache: boolean) {
  isSaving.value = true

  try {
    await save({ seedCache })
    toast.success(t('panel.settings.torrent.saved'), {
      description: t('panel.settings.torrent.savedText'),
    })
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <SettingsCard
    :title="t('panel.settings.torrent.seedCache.title')"
    :description="t('panel.settings.torrent.seedCache.text')"
  >
    <div
      class="flex items-center justify-between gap-4 rounded-lg border border-input px-3 py-2.5"
    >
      <Label for="torrent-seed-cache" class="cursor-pointer font-normal">
        {{ t("panel.settings.torrent.seedCache.label") }}
      </Label>
      <Switch
        id="torrent-seed-cache"
        :model-value="value"
        :disabled="isSaving"
        @update:model-value="onToggle"
      />
    </div>
    <template #hint>
      {{ t(`panel.settings.torrent.seedCache.${value ? "on" : "off"}`) }}
    </template>
  </SettingsCard>
</template>
