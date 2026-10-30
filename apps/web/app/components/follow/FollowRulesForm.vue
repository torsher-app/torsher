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
import AudioLanguageSelect from '~/components/follow/AudioLanguageSelect.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import {
  FOLLOW_AUDIOS,
  FOLLOW_MODES,
  QUALITY_PRESETS,
  waitOptionsFor,
} from '~/lib/follow'

type Preset = FollowSummary['qualityPreset']
type Mode = FollowSummary['mode']

const props = defineProps<{
  follow: FollowSummary
}>()

const { t } = useI18n()
const store = useFollows()

// Те же пределы, что в DTO сервера
const schema = toTypedSchema(
  z.object({
    mode: z.enum(['download', 'notify']),
    // `server` — как у сервера
    audio: z.enum(['server', ...FOLLOW_AUDIOS]),
    voiceStudio: z.string().trim().max(100),
    voiceStrict: z.boolean(),
    waitHours: z.string(),
    qualityPreset: z.enum(['best', 'uhd', 'compact']),
    requireRussian: z.boolean(),
  }),
)

function valuesOf(follow: FollowSummary) {
  return {
    mode: follow.mode as Mode,
    audio: follow.audio ?? ('server' as const),
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

const [mode] = defineField('mode')
const [audio] = defineField('audio')
const [voiceStudio, voiceStudioProps] = defineField('voiceStudio')
const [voiceStrict] = defineField('voiceStrict')
const [waitHours] = defineField('waitHours')
const [qualityPreset] = defineField('qualityPreset')
const [requireRussian] = defineField('requireRussian')

const formError = ref('')

// Студии, «только эта студия» и русская дорожка — правила русской озвучки
const russian = computed(
  () =>
    (values.audio === 'server' ? props.follow.audioServer : values.audio)
    === 'ru',
)

function waitLabel(hours: number) {
  return hours
    ? t('panel.follow.rules.waitHours', { n: hours }, hours)
    : t('panel.follow.rules.noWait')
}
const modeKind = computed(() =>
  props.follow.kind === 'series' ? 'series' : 'movie',
)
const waitOptions = computed(() => waitOptionsFor(props.follow.waitHours))

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
    mode: form.mode,
    audio: !form.audio || form.audio === 'server' ? null : form.audio,
    voiceStudio: studio || null,
    voiceStrict: !!studio && !!form.voiceStrict,
    waitHours: Number(form.waitHours),
    qualityPreset: form.qualityPreset,
    requireRussian: !!form.requireRussian,
  }

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

    <fieldset class="grid gap-2">
      <legend class="mb-2 text-sm font-medium">
        {{ t("panel.follow.rules.mode") }}
      </legend>
      <RadioGroup v-model="mode" class="grid gap-2">
        <Label v-for="item in FOLLOW_MODES" :key="item" :class="choiceClass">
          <RadioGroupItem :value="item" class="mt-0.5" />
          <span class="grid gap-0.5">
            <span class="font-medium">
              {{ t(`panel.follow.modes.${modeKind}.${item}.title`) }}
            </span>
            <span class="text-[12.5px] font-normal text-muted-foreground">
              {{ t(`panel.follow.modes.${modeKind}.${item}.text`) }}
            </span>
          </span>
        </Label>
      </RadioGroup>
    </fieldset>

    <div class="grid gap-2">
      <Label for="follow-audio">{{ t("panel.follow.rules.audio") }}</Label>
      <AudioLanguageSelect
        id="follow-audio"
        v-model="audio"
        :server-language="follow.audioServer"
      />
      <p class="text-[12.5px] text-muted-foreground">
        {{ t("panel.follow.rules.audioHint") }}
      </p>
    </div>

    <div v-if="russian" class="grid gap-2">
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

    <div v-if="russian" class="flex items-start justify-between gap-4">
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

    <div v-if="russian" class="flex items-start justify-between gap-4">
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
