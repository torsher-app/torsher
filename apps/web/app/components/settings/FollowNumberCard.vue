<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  field: 'rssIntervalMin' | 'searchesPerHour'
  value: number
  title: string
  description: string
  unit: string
  /** Пределы DTO сервера; `allowZero` — 0 вне пределов тоже можно (выключить) */
  min: number
  max: number
  allowZero?: boolean
  error: string
}>()

const { t } = useI18n()
const { save } = useFollowSettings()

const schema = toTypedSchema(
  z.object({
    amount: z
      .string()
      .trim()
      .refine((value) => {
        if (!/^\d+$/.test(value))
          return false

        const number = Number(value)

        return (
          (props.allowZero && number === 0)
          || (number >= props.min && number <= props.max)
        )
      }, props.error),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting, meta, resetForm }
  = useForm({
    validationSchema: schema,
    initialValues: { amount: String(props.value) },
  })

const [amount, amountProps] = defineField('amount')

watch(
  () => props.value,
  (value) => {
    if (!meta.value.dirty)
      resetForm({ values: { amount: String(value) } })
  },
)

const onSubmit = handleSubmit(async (values) => {
  await save({ [props.field]: Number(values.amount) })
  resetForm({ values: { amount: String(Number(values.amount)) } })
  toast.success(t('panel.settings.follow.saved'), { description: props.title })
})

const inputId = `follow-${props.field}`
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard :title="title" :description="description">
      <div class="grid gap-2">
        <Label :for="inputId" class="sr-only">{{ title }}</Label>
        <div class="flex w-full max-w-50">
          <Input
            :id="inputId"
            v-model="amount"
            v-bind="amountProps"
            inputmode="numeric"
            autocomplete="off"
            class="rounded-r-none tabular-nums"
            :aria-invalid="!!errors.amount || undefined"
          />
          <span
            class="grid shrink-0 place-items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-[13px] whitespace-nowrap text-muted-foreground"
            aria-hidden="true"
          >
            {{ unit }}
          </span>
        </div>
        <p v-if="errors.amount" class="text-[12.5px] text-destructive">
          {{ errors.amount }}
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
