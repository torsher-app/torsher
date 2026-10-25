<script setup lang="ts">
import type { FollowSummary, UpdateFollowInput } from '@torsher/api-client'
import { getErrorMessage } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import { episodesLabel, QUALITY_PRESETS, waitOptionsFor } from '~/lib/follow'

type Preset = FollowSummary['qualityPreset']
type StartChoice = 'keep' | 'new' | 'season' | 'beginning' | 'custom'

const props = defineProps<{
  follow: FollowSummary
}>()

const { t } = useI18n()
const store = useFollows()

// Те же пределы, что в DTO сервера
const schema = toTypedSchema(
  z
    .object({
      start: z.enum(['keep', 'new', 'season', 'beginning', 'custom']),
      season: z.string().trim(),
      episode: z.string().trim(),
      voiceStudio: z.string().trim().max(100),
      voiceStrict: z.boolean(),
      waitHours: z.string(),
      qualityPreset: z.enum(['best', 'uhd', 'compact']),
      requireRussian: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (values.start !== 'custom')
        return

      const season = Number(values.season)
      const episode = Number(values.episode)

      if (!/^\d+$/.test(values.season) || season < 1 || season > 999) {
        ctx.addIssue({
          code: 'custom',
          path: ['season'],
          message: t('panel.follow.rules.validation.season'),
        })
      }

      if (!/^\d+$/.test(values.episode) || episode < 1 || episode > 9999) {
        ctx.addIssue({
          code: 'custom',
          path: ['episode'],
          message: t('panel.follow.rules.validation.episode'),
        })
      }
    }),
)

function valuesOf(follow: FollowSummary) {
  return {
    start: 'keep' as StartChoice,
    season: String(follow.start.season || 1),
    episode: String(follow.start.episode || 1),
    voiceStudio: follow.voiceStudio ?? '',
    voiceStrict: follow.voiceStrict,
    waitHours: String(follow.waitHours),
    qualityPreset: follow.qualityPreset as Preset,
    requireRussian: follow.requireRussian,
  }
}

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  meta,
  resetForm,
  values,
} = useForm({
  validationSchema: schema,
  initialValues: valuesOf(props.follow),
})

const [start] = defineField('start')
const [season, seasonProps] = defineField('season')
const [episode, episodeProps] = defineField('episode')
const [voiceStudio, voiceStudioProps] = defineField('voiceStudio')
const [voiceStrict] = defineField('voiceStrict')
const [waitHours] = defineField('waitHours')
const [qualityPreset] = defineField('qualityPreset')
const [requireRussian] = defineField('requireRussian')

const formError = ref('')

// Текст выбранного пункта рисуем сами: `SelectValue` не меняет его при смене языка
const START_LABELS: Record<StartChoice, string> = {
  keep: 'panel.follow.rules.startKeep',
  new: 'panel.follow.rules.startNew',
  season: 'panel.follow.rules.startSeason',
  beginning: 'panel.follow.rules.startBeginning',
  custom: 'panel.follow.rules.startCustom',
}

function waitLabel(hours: number) {
  return hours
    ? t('panel.follow.rules.waitHours', { n: hours }, hours)
    : t('panel.follow.rules.noWait')
}
const isSeries = computed(() => props.follow.kind === 'series')
const waitOptions = computed(() => waitOptionsFor(props.follow.waitHours))
const currentStart = computed(() =>
  episodesLabel(props.follow.start.season, [props.follow.start.episode]),
)
const startLabel = computed(() =>
  t(START_LABELS[start.value ?? 'keep'], { episode: currentStart.value }),
)

// Другое слежение или правила сменились снаружи (пауза, «Искать сейчас»):
// нетронутая форма подхватывает новые значения
watch(
  () => props.follow,
  (follow, previous) => {
    if (follow.id !== previous?.id || !meta.value.dirty) {
      formError.value = ''
      resetForm({ values: valuesOf(follow) })
    }
  },
)

// Строго своя студия без студии не имеет смысла
watch(
  () => values.voiceStudio,
  (studio) => {
    if (!studio?.trim())
      voiceStrict.value = false
  },
)

function bodyOf(form: typeof values): UpdateFollowInput {
  const studio = form.voiceStudio?.trim() ?? ''
  const body: UpdateFollowInput = {
    voiceStudio: studio || null,
    voiceStrict: !!studio && !!form.voiceStrict,
    waitHours: Number(form.waitHours),
    qualityPreset: form.qualityPreset,
    requireRussian: !!form.requireRussian,
  }

  if (form.start === 'custom')
    body.start = { season: Number(form.season), episode: Number(form.episode) }
  else if (form.start && form.start !== 'keep')
    body.start = form.start

  return body
}

const onSubmit = handleSubmit(async (form) => {
  formError.value = ''

  try {
    const updated = await store.update(props.follow.id, bodyOf(form))

    resetForm({ values: valuesOf(updated) })
    toast.success(t('panel.follow.rules.saved'), {
      description: updated.title ?? updated.titleId,
    })
  }
  catch (err) {
    formError.value = await getErrorMessage(err)
  }
})

const choiceClass
  = 'relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-xl border border-input p-3 has-[[data-state=checked]]:border-primary'
</script>

<template>
  <form novalidate class="grid gap-4" @submit="onSubmit">
    <h3 class="text-xs font-medium text-muted-foreground">
      {{ t("panel.follow.rules.title") }}
    </h3>

    <Alert v-if="formError" variant="destructive">
      <AlertDescription>{{ formError }}</AlertDescription>
    </Alert>

    <div v-if="isSeries" class="grid gap-2">
      <Label for="follow-start">{{ t("panel.follow.rules.start") }}</Label>
      <Select v-model="start">
        <SelectTrigger id="follow-start" class="w-full">
          <SelectValue>{{ startLabel }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="keep">
            {{ t("panel.follow.rules.startKeep", { episode: currentStart }) }}
          </SelectItem>
          <SelectItem value="new">
            {{ t("panel.follow.rules.startNew") }}
          </SelectItem>
          <SelectItem value="season">
            {{ t("panel.follow.rules.startSeason") }}
          </SelectItem>
          <SelectItem value="beginning">
            {{ t("panel.follow.rules.startBeginning") }}
          </SelectItem>
          <SelectItem value="custom">
            {{ t("panel.follow.rules.startCustom") }}
          </SelectItem>
        </SelectContent>
      </Select>
      <div v-if="start === 'custom'" class="grid grid-cols-2 gap-3">
        <div class="grid gap-1.5">
          <Label for="follow-season" class="text-[12.5px] font-normal">
            {{ t("panel.follow.rules.season") }}
          </Label>
          <Input
            id="follow-season"
            v-model="season"
            v-bind="seasonProps"
            inputmode="numeric"
            autocomplete="off"
            class="tabular-nums"
            :aria-invalid="!!errors.season || undefined"
          />
          <p v-if="errors.season" class="text-[12.5px] text-destructive">
            {{ errors.season }}
          </p>
        </div>
        <div class="grid gap-1.5">
          <Label for="follow-episode" class="text-[12.5px] font-normal">
            {{ t("panel.follow.rules.episode") }}
          </Label>
          <Input
            id="follow-episode"
            v-model="episode"
            v-bind="episodeProps"
            inputmode="numeric"
            autocomplete="off"
            class="tabular-nums"
            :aria-invalid="!!errors.episode || undefined"
          />
          <p v-if="errors.episode" class="text-[12.5px] text-destructive">
            {{ errors.episode }}
          </p>
        </div>
      </div>
      <p v-else class="text-[12.5px] text-muted-foreground">
        {{ t("panel.follow.rules.startHint") }}
      </p>
    </div>

    <div class="grid gap-2">
      <Label for="follow-studio">{{ t("panel.follow.rules.voice") }}</Label>
      <Input
        id="follow-studio"
        v-model="voiceStudio"
        v-bind="voiceStudioProps"
        autocomplete="off"
        :placeholder="t('panel.follow.rules.voicePlaceholder')"
        :aria-invalid="!!errors.voiceStudio || undefined"
      />
      <p class="text-[12.5px] text-muted-foreground">
        {{ t("panel.follow.rules.voiceHint") }}
      </p>
    </div>

    <div class="flex items-start justify-between gap-4">
      <div class="grid gap-1">
        <Label for="follow-strict">{{ t("panel.follow.rules.strict") }}</Label>
        <p class="text-[12.5px] text-muted-foreground">
          {{ t("panel.follow.rules.strictHint") }}
        </p>
      </div>
      <Switch
        id="follow-strict"
        v-model="voiceStrict"
        :disabled="!voiceStudio?.trim()"
      />
    </div>

    <div class="grid gap-2">
      <Label for="follow-wait">{{ t("panel.follow.rules.wait") }}</Label>
      <Select v-model="waitHours">
        <SelectTrigger id="follow-wait" class="w-full">
          <SelectValue>{{ waitLabel(Number(waitHours)) }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="hours in waitOptions"
            :key="hours"
            :value="String(hours)"
          >
            {{ waitLabel(hours) }}
          </SelectItem>
        </SelectContent>
      </Select>
      <p class="text-[12.5px] text-muted-foreground">
        {{ t("panel.follow.rules.waitHint") }}
      </p>
    </div>

    <fieldset class="grid gap-2">
      <legend class="mb-2 text-sm font-medium">
        {{ t("panel.follow.rules.quality") }}
      </legend>
      <RadioGroup v-model="qualityPreset" class="grid gap-2">
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

    <div class="flex items-start justify-between gap-4">
      <div class="grid gap-1">
        <Label for="follow-russian">{{
          t("panel.follow.rules.russian")
        }}</Label>
        <p class="text-[12.5px] text-muted-foreground">
          {{ t("panel.follow.rules.russianHint") }}
        </p>
      </div>
      <Switch id="follow-russian" v-model="requireRussian" />
    </div>

    <div class="flex justify-end">
      <LoadingButton
        type="submit"
        size="sm"
        variant="outline"
        :loading="isSubmitting"
        :disabled="!meta.dirty"
      >
        {{ t("panel.follow.rules.save") }}
      </LoadingButton>
    </div>
  </form>
</template>
