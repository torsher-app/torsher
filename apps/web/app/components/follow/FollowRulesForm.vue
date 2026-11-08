<script setup lang="ts">
import type { FollowSummary, UpdateFollowInput } from '@torsher/api-client'
import { demoStudios } from '@torsher/demo/studios'
import { studios } from '@torsher/release-parser/studio-search'
import { getErrorMessage } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { api } from '~/services/api'
import {
  canonicalStudio,
  followVoiceBody,
  followVoiceError,
  mergeStudioEvidence,
} from '~/lib/followVoiceRules'
import { Button } from '@/components/ui/button'
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
import StudioSelect from '~/components/follow/StudioSelect.vue'
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
const studioCollection = __DEMO__ ? demoStudios : studios
const voiceList = ref<Awaited<ReturnType<typeof api.titles.getFollowVoices>>>()

// Те же пределы, что в DTO сервера
const schema = toTypedSchema(
  z
    .object({
      mode: z.enum(['download', 'notify']),
      // `server` — как у сервера
      audio: z.enum(['server', ...FOLLOW_AUDIOS]),
      voiceStudio: z.string().trim().max(100),
      voiceStrict: z.boolean(),
      voiceMode: z.enum(['legacy', 'auto', 'prefer', 'only', 'any']),
      waitHours: z.string(),
      qualityPreset: z.enum(['best', 'uhd', 'compact']),
      requireRussian: z.boolean(),
    })
    .superRefine((value, ctx) => {
      const voiceError = followVoiceError(
        props.follow,
        value,
        studioCollection,
      )
      if (voiceError) {
        ctx.addIssue({
          code: 'custom',
          path: ['voiceStudio'],
          message: t(`follow.studio.${voiceError}`),
        })
      }
    }),
)

function valuesOf(follow: FollowSummary) {
  return {
    mode: follow.mode as Mode,
    audio: follow.audio ?? ('server' as const),
    voiceStudio:
      follow.voicePolicy && 'studio' in follow.voicePolicy
        ? (follow.voicePolicy.studio ?? '')
        : (follow.voiceStudio ?? ''),
    voiceMode: follow.voicePolicy?.mode ?? 'legacy',
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
const [voiceMode] = defineField('voiceMode')
const modern = computed(() => props.follow.voicePolicy !== undefined)
const [voiceStrict] = defineField('voiceStrict')
const [waitHours] = defineField('waitHours')
const [qualityPreset] = defineField('qualityPreset')
const [requireRussian] = defineField('requireRussian')

const formError = ref('')
const voiceLoading = ref(false)
const voiceError = ref(false)
let voiceRequest = 0
const voiceSeason = computed(() =>
  props.follow.kind === 'movie'
    ? 0
    : (props.follow.voiceResolution?.season ?? props.follow.start.season),
)
async function loadVoices(refresh = false) {
  const token = ++voiceRequest
  voiceLoading.value = true
  voiceError.value = false
  try {
    const result = await withErrorMode('silent', () =>
      api.titles.getFollowVoices(props.follow.titleId, {
        season: voiceSeason.value,
        ...(refresh ? { refresh: '1' as const } : {}),
      }))
    if (token === voiceRequest)
      voiceList.value = result
  }
  catch {
    if (token === voiceRequest)
      voiceError.value = true
  }
  finally {
    if (token === voiceRequest)
      voiceLoading.value = false
  }
}
watch(
  () => `${props.follow.id}|${voiceSeason.value}`,
  () => {
    voiceRequest++
    voiceList.value = undefined
    if (modern.value)
      void loadVoices()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  voiceRequest++
})
const foundStudios = computed(() => [
  ...mergeStudioEvidence(
    voiceList.value?.items ?? [],
    studioCollection,
  ).values(),
])
const savedStudio = computed(() => {
  const policy = props.follow.voicePolicy
  return policy?.mode === 'prefer' || policy?.mode === 'only'
    ? policy.studio
    : undefined
})
const onlyWarning = computed(() => {
  if (voiceMode.value !== 'only' || !voiceStudio.value)
    return ''
  if (
    foundStudios.value.some(
      item =>
        item.found
        && item.studio === canonicalStudio(voiceStudio.value!, studioCollection),
    )
  ) {
    return ''
  }
  if (
    voiceError.value
    || voiceList.value?.failed.length
    || !voiceList.value
    || !voiceList.value.indexerCount
  ) {
    return t('follow.studio.onlyUncertain', { studio: voiceStudio.value })
  }
  if (voiceList.value.cache === 'miss')
    return t('follow.studio.onlyNoCache', { studio: voiceStudio.value })
  return t('follow.studio.onlyWaiting', { studio: voiceStudio.value })
})
const resolutionText = computed(() => {
  const resolution = props.follow.voiceResolution
  if (!resolution || resolution.source === 'explicit')
    return ''
  return t(`follow.studio.sources.${resolution.source}`, {
    studio:
      resolution.studio
      ?? (resolution.type ? t(`sources.voiceTypes.${resolution.type}`) : ''),
    season: resolution.sourceSeason ?? resolution.season,
  })
})

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
  const body: UpdateFollowInput = {
    mode: form.mode,
    audio: !form.audio || form.audio === 'server' ? null : form.audio,

    waitHours: Number(form.waitHours),
    qualityPreset: form.qualityPreset,
    requireRussian: !!form.requireRussian,
  }

  Object.assign(body, followVoiceBody(props.follow, form, studioCollection))
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
    <div class="grid gap-1.5">
      <h3 class="text-xs font-medium text-muted-foreground">
        {{ t("panel.follow.rules.title") }}
      </h3>
      <p class="text-[12.5px] text-muted-foreground">
        {{ t("follow.panel.sharedRules") }}
      </p>
    </div>

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

    <div v-if="modern" class="grid gap-2">
      <Label for="follow-voice-mode">{{ t("follow.studio.title") }}</Label>
      <Select v-model="voiceMode">
        <SelectTrigger id="follow-voice-mode">
          <SelectValue>{{ t(`follow.studio.${voiceMode}`) }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-if="follow.voicePolicy?.mode === 'legacy'"
            value="legacy"
          >
            {{ t("follow.studio.legacy") }}
          </SelectItem>
          <SelectItem
            v-for="policy in ['auto', 'prefer', 'only', 'any']"
            :key="policy"
            :value="policy"
          >
            {{ t(`follow.studio.${policy}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
      <p class="text-[12.5px] text-muted-foreground">
        {{
          t(
            voiceMode === "legacy"
              ? "follow.studio.legacy"
              : `follow.studio.${voiceMode}Hint`,
          )
        }}
      </p>
      <p
        v-if="
          follow.voicePolicy?.mode === 'legacy' && follow.voicePolicy.studio
        "
        class="text-[12.5px] text-muted-foreground"
      >
        {{
          t("follow.studio.legacyValue", { studio: follow.voicePolicy.studio })
        }}
      </p>
      <p v-if="resolutionText" class="text-[12.5px] text-muted-foreground">
        {{ resolutionText }}
      </p>
      <p v-if="!russian" class="text-[12.5px] text-muted-foreground">
        {{ t("follow.studio.inactive") }}
      </p>
      <p class="text-[12.5px] text-muted-foreground">
        {{ t("follow.studio.trackHint") }}
      </p>
    </div>
    <p v-else class="text-[12.5px] text-muted-foreground">
      {{ t("follow.studio.oldServer") }}
    </p>

    <div
      v-if="modern ? voiceMode === 'prefer' || voiceMode === 'only' : russian"
      class="grid gap-2"
    >
      <template v-if="modern">
        <Label for="follow-studio-list">{{
          t("panel.follow.rules.voice")
        }}</Label>
        <StudioSelect
          :key="`${follow.id}|${voiceSeason}`"
          v-model="voiceStudio"
          :collection="studioCollection"
          :items="foundStudios"
          :saved="savedStudio"
          :season="voiceSeason"
          :disabled="isSubmitting"
          :invalid="!!errors.voiceStudio"
        />
        <p v-if="onlyWarning" class="text-[12.5px] text-muted-foreground">
          {{ onlyWarning }}
        </p>
      </template>
      <template v-else>
        <Label for="follow-studio">{{ t("panel.follow.rules.voice") }}</Label>
        <Input
          id="follow-studio"
          v-model="voiceStudio"
          v-bind="voiceStudioProps"
          autocomplete="off"
          :placeholder="t('panel.follow.rules.voicePlaceholder')"
          :aria-invalid="!!errors.voiceStudio || undefined"
        />
      </template>
      <div v-if="modern" class="grid gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="voiceLoading || isSubmitting"
          @click="loadVoices(true)"
        >
          {{
            t(
              voiceLoading
                ? "follow.studio.searching"
                : voiceList?.updatedAt
                  ? "follow.studio.refresh"
                  : "follow.studio.find",
            )
          }}
        </Button>
        <p class="text-[12.5px] text-muted-foreground">
          {{
            t(
              follow.kind === "series"
                ? "follow.studio.context"
                : "follow.studio.contextMovie",
              { season: voiceSeason },
            )
          }}
        </p>
        <p v-if="voiceError" class="text-[12.5px] text-destructive">
          {{ t("follow.studio.error") }}
        </p>
        <p
          v-if="voiceList?.failed.length"
          class="text-[12.5px] text-muted-foreground"
        >
          {{ t("follow.studio.partial") }}
        </p>
        <p
          v-if="
            voiceList?.cache === 'hit'
              && !foundStudios.some((item) => item.found)
          "
          class="text-[12.5px] text-muted-foreground"
        >
          {{ t("follow.studio.empty") }}
        </p>
        <p
          v-if="voiceList?.cache === 'miss'"
          class="text-[12.5px] text-muted-foreground"
        >
          {{ t("follow.studio.cacheMiss") }}
        </p>
        <p
          v-if="voiceList?.updatedAt"
          class="text-[12.5px] text-muted-foreground"
        >
          {{
            t("follow.studio.updated", {
              date: new Date(voiceList.updatedAt).toLocaleString(),
            })
          }}
        </p>
        <p v-if="voiceList?.stale" class="text-[12.5px] text-muted-foreground">
          {{ t("follow.studio.stale") }}
        </p>
        <p
          v-if="voiceList && !voiceList.indexerCount"
          class="text-[12.5px] text-muted-foreground"
        >
          {{ t("follow.studio.noIndexers") }}
        </p>
      </div>
      <p v-if="errors.voiceStudio" class="text-[12.5px] text-destructive">
        {{ errors.voiceStudio }}
      </p>
      <p v-else-if="!modern" class="text-[12.5px] text-muted-foreground">
        {{ t("panel.follow.rules.voiceHint") }}
      </p>
    </div>

    <div
      v-if="russian && !modern"
      class="flex items-start justify-between gap-4"
    >
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

    <div v-if="audio === 'ru'" class="flex items-start justify-between gap-4">
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
