<script setup lang="ts">
import type { FollowSettings } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import LoadingButton from '~/components/LoadingButton.vue'
import { QUALITY_PRESETS, waitOptionsFor } from '~/lib/follow'
import SettingsCard from './SettingsCard.vue'

type Defaults = FollowSettings['defaults']

const props = defineProps<{
  defaults: Defaults
}>()

const { t } = useI18n()
const { save } = useFollowSettings()

const RUSSIAN = ['auto', 'always', 'never'] as const

const schema = toTypedSchema(
  z.object({
    waitHours: z.string(),
    movieWaitHours: z.string(),
    qualityPreset: z.enum(QUALITY_PRESETS),
    requireRussian: z.enum(RUSSIAN),
  }),
)

function valuesOf(defaults: Defaults) {
  return {
    waitHours: String(defaults.waitHours),
    movieWaitHours: String(defaults.movieWaitHours),
    qualityPreset: defaults.qualityPreset,
    requireRussian: defaults.requireRussian,
  }
}

const { handleSubmit, defineField, isSubmitting, meta, resetForm } = useForm({
  validationSchema: schema,
  initialValues: valuesOf(props.defaults),
})

const [waitHours] = defineField('waitHours')
const [movieWaitHours] = defineField('movieWaitHours')
const [qualityPreset] = defineField('qualityPreset')
const [requireRussian] = defineField('requireRussian')

const seriesOptions = computed(() => waitOptionsFor(props.defaults.waitHours))
const movieOptions = computed(() =>
  waitOptionsFor(props.defaults.movieWaitHours),
)

watch(
  () => props.defaults,
  (defaults) => {
    if (!meta.value.dirty)
      resetForm({ values: valuesOf(defaults) })
  },
)

const onSubmit = handleSubmit(async (values) => {
  const saved = await save({
    defaults: {
      waitHours: Number(values.waitHours),
      movieWaitHours: Number(values.movieWaitHours),
      qualityPreset: values.qualityPreset,
      requireRussian: values.requireRussian,
    },
  })

  resetForm({ values: valuesOf(saved.defaults) })
  toast.success(t('panel.settings.follow.saved'), {
    description: t('panel.settings.follow.defaults.title'),
  })
})

function waitLabel(hours: number) {
  return hours
    ? t('panel.follow.rules.waitHours', { n: hours }, hours)
    : t('panel.follow.rules.noWait')
}

const choiceClass
  = 'relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-xl border border-input p-3 has-[[data-state=checked]]:border-primary'
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.follow.defaults.title')"
      :description="t('panel.settings.follow.defaults.description')"
    >
      <div class="grid gap-5">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="follow-default-wait">{{
              t("panel.settings.follow.defaults.wait")
            }}</Label>
            <Select v-model="waitHours">
              <SelectTrigger id="follow-default-wait" class="w-full">
                <SelectValue>{{ waitLabel(Number(waitHours)) }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="hours in seriesOptions"
                  :key="hours"
                  :value="String(hours)"
                >
                  {{ waitLabel(hours) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-2">
            <Label for="follow-default-movie-wait">{{
              t("panel.settings.follow.defaults.movieWait")
            }}</Label>
            <Select v-model="movieWaitHours">
              <SelectTrigger id="follow-default-movie-wait" class="w-full">
                <SelectValue>
                  {{ waitLabel(Number(movieWaitHours)) }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="hours in movieOptions"
                  :key="hours"
                  :value="String(hours)"
                >
                  {{ waitLabel(hours) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p class="text-[12.5px] text-muted-foreground sm:col-span-2">
            {{ t("panel.follow.rules.waitHint") }}
          </p>
        </div>

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">
            {{ t("panel.follow.rules.quality") }}
          </legend>
          <RadioGroup v-model="qualityPreset" class="grid gap-2 md:grid-cols-3">
            <Label
              v-for="preset in QUALITY_PRESETS"
              :key="preset"
              :class="choiceClass"
            >
              <RadioGroupItem :value="preset" class="mt-0.5" />
              <span class="grid gap-0.5">
                <span class="font-medium">
                  {{ t(`panel.follow.presets.${preset}.title`) }}
                </span>
                <span class="text-[12.5px] font-normal text-muted-foreground">
                  {{ t(`panel.follow.presets.${preset}.text`) }}
                </span>
              </span>
            </Label>
          </RadioGroup>
        </fieldset>

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">
            {{ t("panel.follow.rules.russian") }}
          </legend>
          <RadioGroup
            v-model="requireRussian"
            class="grid gap-2 md:grid-cols-3"
          >
            <Label v-for="item in RUSSIAN" :key="item" :class="choiceClass">
              <RadioGroupItem :value="item" class="mt-0.5" />
              <span class="grid gap-0.5">
                <span class="font-medium">
                  {{
                    t(`panel.settings.follow.defaults.russian.${item}.title`)
                  }}
                </span>
                <span class="text-[12.5px] font-normal text-muted-foreground">
                  {{ t(`panel.settings.follow.defaults.russian.${item}.text`) }}
                </span>
              </span>
            </Label>
          </RadioGroup>
        </fieldset>
      </div>
      <template #hint>
        {{ t("panel.settings.follow.defaults.hint") }}
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
