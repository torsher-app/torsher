<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import {
  fieldNumber,
  MAX_SPEED_MB,
  speedBytes,
  speedField,
} from '~/lib/torrentSettings'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  field: 'downloadLimit' | 'uploadLimit'
  /** Байт/с, 0 — без лимита */
  value: number
  title: string
  description: string
}>()

const { t, locale } = useI18n()
const { save } = useTorrentSettings()

// Пустое поле — без лимита; иначе от 0,01 МБ/с, как минимум в байтах у DTO
const schema = toTypedSchema(
  z.object({
    speed: z
      .string()
      .trim()
      .refine(
        value => value === '' || /^\d+(?:[.,]\d+)?$/.test(value),
        t('panel.settings.torrent.validation.number'),
      )
      .refine(
        value =>
          value === ''
          || (fieldNumber(value) >= 0.01 && fieldNumber(value) <= MAX_SPEED_MB),
        t('panel.settings.torrent.validation.speed'),
      ),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting, meta, resetForm }
  = useForm({
    validationSchema: schema,
    initialValues: { speed: speedField(props.value, locale.value) },
  })

const [speed, speedProps] = defineField('speed')

watch(
  () => props.value,
  (value) => {
    if (!meta.value.dirty)
      resetForm({ values: { speed: speedField(value, locale.value) } })
  },
)

const onSubmit = handleSubmit(async (values) => {
  await save({ [props.field]: speedBytes(values.speed) })
  resetForm({ values: { speed: values.speed.trim() } })
  toast.success(t('panel.settings.torrent.saved'), {
    description: t('panel.settings.torrent.savedText'),
  })
})

const inputId = `torrent-${props.field}`
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard :title="title" :description="description">
      <div class="grid gap-2">
        <Label :for="inputId" class="sr-only">{{ title }}</Label>
        <div class="flex w-full max-w-50">
          <Input
            :id="inputId"
            v-model="speed"
            v-bind="speedProps"
            inputmode="decimal"
            autocomplete="off"
            :placeholder="t('panel.settings.torrent.noLimit')"
            class="rounded-r-none tabular-nums"
            :aria-invalid="!!errors.speed || undefined"
          />
          <span
            class="grid shrink-0 place-items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-[13px] text-muted-foreground"
            aria-hidden="true"
          >
            {{ t("panel.settings.torrent.unitSpeed") }}
          </span>
        </div>
        <p v-if="errors.speed" class="text-[12.5px] text-destructive">
          {{ errors.speed }}
        </p>
      </div>
      <template #hint>
        <slot name="hint" />
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
