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
  /** Поле политики, которое правит карточка */
  field: 'cacheLimit' | 'minFree'
  /** Текущее значение в байтах */
  value: number
  title: string
  description: string
  savedTitle: string
}>()

const GIB = 1024 ** 3

const { t, locale } = useI18n()
const { savePolicy } = useStorage()

function toGib(bytes: number) {
  return new Intl.NumberFormat(locale.value.replace('_', '-'), {
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(bytes / GIB)
}

// Минимум совпадает с DTO сервера: от 1 ГБ; дробная часть — через точку или запятую
const schema = toTypedSchema(
  z.object({
    size: z
      .string()
      .trim()
      .regex(/^\d+(?:[.,]\d+)?$/, t('panel.settings.storage.validation.number'))
      .refine(
        value => Number(value.replace(',', '.')) >= 1,
        t('panel.settings.storage.validation.min'),
      ),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting, meta, resetForm }
  = useForm({
    validationSchema: schema,
    initialValues: { size: toGib(props.value) },
  })

const [size, sizeProps] = defineField('size')

// Сервер мог изменить значение (другая вкладка): нетронутая карточка его подхватывает
watch(
  () => props.value,
  (value) => {
    if (!meta.value.dirty)
      resetForm({ values: { size: toGib(value) } })
  },
)

const onSubmit = handleSubmit(async (values) => {
  const bytes = Math.round(Number(values.size.replace(',', '.')) * GIB)

  await savePolicy({ [props.field]: bytes })
  resetForm({ values: { size: values.size } })
  toast.success(props.savedTitle, {
    description: t('panel.settings.storage.savedText'),
  })
})

const inputId = `storage-${props.field}`
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard :title="title" :description="description">
      <div class="grid gap-2">
        <Label :for="inputId" class="sr-only">{{ title }}</Label>
        <!-- Единица — суффиксом поля, а не в подписи -->
        <div class="flex w-full max-w-50">
          <Input
            :id="inputId"
            v-model="size"
            v-bind="sizeProps"
            inputmode="decimal"
            autocomplete="off"
            class="rounded-r-none tabular-nums"
            :aria-invalid="!!errors.size || undefined"
          />
          <span
            class="grid shrink-0 place-items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-[13px] text-muted-foreground"
            aria-hidden="true"
          >
            {{ t("panel.settings.storage.unit") }}
          </span>
        </div>
        <p v-if="errors.size" class="text-[12.5px] text-destructive">
          {{ errors.size }}
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
