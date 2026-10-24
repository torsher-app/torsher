<script setup lang="ts">
import type { TorrentSettingValues } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import SettingsCard from './SettingsCard.vue'
import TorrentRestartBadge from './TorrentRestartBadge.vue'

const props = defineProps<{
  value: TorrentSettingValues['encryption']
  defaultValue: TorrentSettingValues['encryption']
}>()

const { t } = useI18n()
const { save } = useTorrentSettings()

const MODES = ['prefer', 'require'] as const

const { handleSubmit, defineField, isSubmitting, meta, resetForm } = useForm({
  validationSchema: toTypedSchema(z.object({ encryption: z.enum(MODES) })),
  initialValues: { encryption: props.value },
})

const [encryption, encryptionProps] = defineField('encryption')

watch(
  () => props.value,
  (value) => {
    if (!meta.value.dirty)
      resetForm({ values: { encryption: value } })
  },
)

const onSubmit = handleSubmit(async (fields) => {
  await save(fields)
  resetForm({ values: fields })
  toast.success(t('panel.settings.torrent.saved'), {
    description: t('panel.settings.torrent.savedRestart'),
  })
})

const choiceClass
  = 'relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-xl border border-input p-3.5 has-[[data-state=checked]]:border-primary'
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.torrent.encryption.title')"
      :description="t('panel.settings.torrent.encryption.text')"
    >
      <template #badge>
        <TorrentRestartBadge />
      </template>
      <RadioGroup
        v-model="encryption"
        v-bind="encryptionProps"
        :aria-label="t('panel.settings.torrent.encryption.title')"
        class="grid gap-2.5 sm:grid-cols-2"
      >
        <Label v-for="mode in MODES" :key="mode" :class="choiceClass">
          <RadioGroupItem :value="mode" class="mt-0.5" />
          <span class="grid gap-0.5">
            <span class="font-medium">
              {{ t(`panel.settings.torrent.encryption.${mode}`) }}
            </span>
            <span class="text-[12.5px] font-normal text-muted-foreground">
              {{ t(`panel.settings.torrent.encryption.${mode}Text`) }}
            </span>
          </span>
        </Label>
      </RadioGroup>
      <template #hint>
        {{
          t("panel.settings.torrent.defaultIs", {
            value: t(
              `panel.settings.torrent.encryption.${defaultValue}`,
            ).toLowerCase(),
          })
        }}
      </template>
      <template #action>
        <LoadingButton
          type="submit"
          size="sm"
          :loading="isSubmitting"
          :disabled="!meta.dirty"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </template>
    </SettingsCard>
  </form>
</template>
