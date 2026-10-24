<script setup lang="ts">
import type { BackupStatus } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useNow } from '@vueuse/core'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatWhen } from '~/lib/backups'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  status: BackupStatus
}>()

const { t, locale } = useI18n()
const { saveSettings } = useBackups()
const now = useNow({ interval: 60_000 })

const base = 'panel.backups.schedule'
const unitClass
  = 'grid shrink-0 place-items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-[13px] text-muted-foreground'

function inRange(min: number, max: number) {
  return (value: string) => {
    const number = Number(value)

    return Number.isInteger(number) && number >= min && number <= max
  }
}

// Правила совпадают с DTO сервера: время ЧЧ:ММ, ежедневных 1–30, еженедельных 0–12
const schema = toTypedSchema(
  z.object({
    enabled: z.boolean(),
    time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, t(`${base}.validation.time`)),
    keepDaily: z
      .string()
      .trim()
      .refine(inRange(1, 30), t(`${base}.validation.daily`)),
    keepWeekly: z
      .string()
      .trim()
      .refine(inRange(0, 12), t(`${base}.validation.weekly`)),
  }),
)

function valuesOf(settings: BackupStatus['settings']) {
  return {
    enabled: settings.enabled,
    time: settings.time,
    keepDaily: String(settings.keepDaily),
    keepWeekly: String(settings.keepWeekly),
  }
}

const { handleSubmit, defineField, errors, isSubmitting, meta, resetForm }
  = useForm({
    validationSchema: schema,
    initialValues: valuesOf(props.status.settings),
  })

const [enabled] = defineField('enabled')
const [time, timeProps] = defineField('time')
const [keepDaily, keepDailyProps] = defineField('keepDaily')
const [keepWeekly, keepWeeklyProps] = defineField('keepWeekly')

// Другая вкладка могла сохранить своё: нетронутая карточка его подхватывает
watch(
  () => props.status.settings,
  (settings) => {
    if (!meta.value.dirty)
      resetForm({ values: valuesOf(settings) })
  },
)

const hint = computed(() => {
  if (props.status.state.running)
    return t(`${base}.running`)

  if (!props.status.settings.enabled || !props.status.state.nextAt)
    return t(`${base}.off`)

  return t(`${base}.next`, {
    when: formatWhen(t, props.status.state.nextAt, locale.value, {
      timeZone: props.status.state.timezone,
      now: now.value,
    }),
  })
})

const onSubmit = handleSubmit(async (values) => {
  await saveSettings({
    enabled: values.enabled,
    time: values.time,
    keepDaily: Number(values.keepDaily),
    keepWeekly: Number(values.keepWeekly),
  })
  resetForm({ values })
  toast.success(t(`${base}.saved`))
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard :title="t(`${base}.title`)" :description="t(`${base}.text`)">
      <div class="grid gap-4">
        <div class="flex items-center gap-3">
          <Switch id="backup-enabled" v-model="enabled" />
          <Label for="backup-enabled" class="font-normal">
            {{ t(`${base}.enabled`) }}
          </Label>
        </div>

        <div class="grid gap-4 sm:grid-cols-[auto_auto_auto] sm:justify-start">
          <div class="grid content-start gap-2">
            <Label for="backup-time">{{ t(`${base}.time`) }}</Label>
            <Input
              id="backup-time"
              v-model="time"
              v-bind="timeProps"
              type="time"
              class="w-full tabular-nums sm:w-32"
              :disabled="!enabled"
              aria-describedby="backup-time-hint"
              :aria-invalid="!!errors.time || undefined"
            />
            <p
              v-if="errors.time"
              id="backup-time-hint"
              class="text-[12.5px] text-destructive"
            >
              {{ errors.time }}
            </p>
            <p
              v-else
              id="backup-time-hint"
              class="text-[12.5px] text-muted-foreground"
            >
              {{ t(`${base}.timeHint`, { zone: status.state.timezone }) }}
            </p>
          </div>

          <div class="grid content-start gap-2">
            <Label for="backup-keep-daily">{{ t(`${base}.keepDaily`) }}</Label>
            <!-- Единица — суффиксом поля, а не в подписи -->
            <div class="flex w-full sm:w-32">
              <Input
                id="backup-keep-daily"
                v-model="keepDaily"
                v-bind="keepDailyProps"
                inputmode="numeric"
                autocomplete="off"
                class="rounded-r-none tabular-nums"
                :aria-invalid="!!errors.keepDaily || undefined"
              />
              <span :class="unitClass" aria-hidden="true">
                {{ t(`${base}.days`) }}
              </span>
            </div>
            <p v-if="errors.keepDaily" class="text-[12.5px] text-destructive">
              {{ errors.keepDaily }}
            </p>
          </div>

          <div class="grid content-start gap-2">
            <Label for="backup-keep-weekly">{{
              t(`${base}.keepWeekly`)
            }}</Label>
            <div class="flex w-full sm:w-32">
              <Input
                id="backup-keep-weekly"
                v-model="keepWeekly"
                v-bind="keepWeeklyProps"
                inputmode="numeric"
                autocomplete="off"
                class="rounded-r-none tabular-nums"
                :aria-invalid="!!errors.keepWeekly || undefined"
              />
              <span :class="unitClass" aria-hidden="true">
                {{ t(`${base}.weeks`) }}
              </span>
            </div>
            <p v-if="errors.keepWeekly" class="text-[12.5px] text-destructive">
              {{ errors.keepWeekly }}
            </p>
          </div>
        </div>
        <p class="-mt-1 text-[12.5px] text-muted-foreground">
          {{ t(`${base}.keepHint`) }}
        </p>
      </div>
      <template #hint>
        <span class="tabular-nums">{{ hint }}</span>
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
