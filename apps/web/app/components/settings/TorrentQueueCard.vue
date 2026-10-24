<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  value: number
  defaultValue: number
}>()

const { t } = useI18n()
const { save } = useTorrentSettings()

const schema = toTypedSchema(
  z.object({
    count: z
      .string()
      .trim()
      .regex(/^\d+$/, t('panel.settings.torrent.validation.integer'))
      .refine(
        value => Number(value) <= 100,
        t('panel.settings.torrent.validation.queue'),
      ),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting, meta, resetForm }
  = useForm({
    validationSchema: schema,
    initialValues: { count: String(props.value) },
  })

const [count, countProps] = defineField('count')

watch(
  () => props.value,
  (value) => {
    if (!meta.value.dirty)
      resetForm({ values: { count: String(value) } })
  },
)

const onSubmit = handleSubmit(async (values) => {
  await save({ activeDownloads: Number(values.count) })
  resetForm({ values: { count: String(Number(values.count)) } })
  toast.success(t('panel.settings.torrent.saved'), {
    description: t('panel.settings.torrent.savedText'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.torrent.queue.title')"
      :description="t('panel.settings.torrent.queue.text')"
    >
      <div class="grid gap-2">
        <Label for="torrent-queue" class="sr-only">
          {{ t("panel.settings.torrent.queue.title") }}
        </Label>
        <Input
          id="torrent-queue"
          v-model="count"
          v-bind="countProps"
          inputmode="numeric"
          autocomplete="off"
          class="w-full max-w-24 tabular-nums"
          :aria-invalid="!!errors.count || undefined"
        />
        <p v-if="errors.count" class="text-[12.5px] text-destructive">
          {{ errors.count }}
        </p>
        <p v-else class="text-[12.5px] text-muted-foreground">
          {{ t("panel.settings.torrent.queue.hint") }}
        </p>
      </div>
      <template #hint>
        {{ t("panel.settings.torrent.defaultIs", { value: defaultValue }) }}
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
