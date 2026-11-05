<script setup lang="ts">
import type {
  FollowTitleInput,
  TitleFollow,
  TitleFollowResponse,
} from '@torsher/api-client'
import type { PanelOption } from './OptionsPanel.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useFollowVoices } from '../composables/useFollowVoices.ts'
import { useI18n } from 'vue-i18n'
import { useFollowTexts } from '../composables/useTitleFollow.ts'
import {
  FOLLOW_AUDIOS,
  FOLLOW_MODES,
  isFollowAudio,
  QUALITY_LADDERS,
  QUALITY_PRESETS,
  qualityName,
  voiceChoices,
  waitChoices,
} from '../lib/follow.ts'
import OptionsPanel from './OptionsPanel.vue'

// `language` — вложенный шаг «Озвучки»: другой язык при русской
type Step
  = 'main' | 'mode' | 'voice' | 'language' | 'studio' | 'wait' | 'quality'

/**
 * Лист правил «Следить»: пункты со значением справа, OK открывает шаг с
 * вариантами, выбор сразу уходит на сервер и возвращает к пунктам. Профиль,
 * которому правила не менять, видит их неактивными; «Не следить» есть всегда.
 */
const props = defineProps<{
  title: string
  titleId: string
  view: TitleFollowResponse & { follow: TitleFollow }
  save: (body: FollowTitleInput) => Promise<boolean>
}>()

const emit = defineEmits<{
  close: []
  stop: []
}>()

const { t } = useI18n()
const texts = useFollowTexts()

const follow = computed(() => props.view.follow)
const series = computed(() => follow.value.kind === 'series')
const editable = computed(() => props.view.canEdit)

const step = ref<Step>('main')
const saving = ref(false)
const saveError = ref(false)
const chosenMode = ref<'prefer' | 'only'>('prefer')
let alive = true
onBeforeUnmount(() => {
  alive = false
})
const modern = computed(() => follow.value.voicePolicy !== undefined)
const season = computed(() =>
  follow.value.kind === 'movie' ? 0 : follow.value.season,
)
const {
  data: voices,
  loading,
  error: searchError,
  load: loadVoices,
} = useFollowVoices(
  computed(() => props.titleId),
  season,
  editable,
)
watch(
  () => `${props.titleId}|${season.value}`,
  () => {
    if (step.value === 'studio')
      void loadVoices()
  },
)
async function persist(body: FollowTitleInput) {
  if (!editable.value || saving.value)
    return
  const savedStep = step.value
  saving.value = true
  saveError.value = false
  try {
    const ok = await props.save(body)
    if (alive) {
      saveError.value = !ok
      if (ok && step.value === savedStep)
        toMain(savedStep)
    }
  }
  catch {
    if (alive)
      saveError.value = true
  }
  finally {
    if (alive)
      saving.value = false
  }
}

// Возврат из шага — на пункт, который его открыл
const returnTo = ref<string>()

const studio = computed(
  () => follow.value.voice?.studio ?? follow.value.voiceStudio ?? undefined,
)
// Студии и типы перевода есть только у русской озвучки
const russian = computed(() => follow.value.audioEffective === 'ru')

function audioName(audio: string) {
  return t(`audioLanguages.${audio}`)
}

function voiceValue() {
  const policy = follow.value.voicePolicy
  if (policy) {
    return policy.mode === 'prefer' || policy.mode === 'only'
      ? t(`follow.studio.${policy.mode}Value`, { studio: policy.studio })
      : t(`follow.studio.${policy.mode}`)
  }

  if (!russian.value)
    return audioName(follow.value.audioEffective)

  if (!studio.value)
    return t('follow.panel.voiceAny')

  return follow.value.voiceStrict
    ? t('follow.panel.voiceOnly', { studio: studio.value })
    : studio.value
}

function rule(id: Step, label: string, value: string): PanelOption {
  return {
    id,
    label,
    selected: false,
    detail: editable.value ? `${value} ›` : value,
    disabled: !editable.value,
  }
}

function modeLabel(mode: (typeof FOLLOW_MODES)[number]) {
  return t(`follow.panel.${series.value ? 'modes' : 'modesMovie'}.${mode}`)
}

const mainOptions = computed<PanelOption[]>(() => {
  const value = follow.value
  const list: PanelOption[] = []

  list.push(
    rule('mode', t('follow.panel.mode'), modeLabel(value.mode)),
    rule(
      'language',
      t('follow.panel.language'),
      audioName(value.audioEffective),
    ),
    rule('voice', t('follow.studio.title'), voiceValue()),
    rule('wait', t('follow.panel.wait'), texts.waitLabel(value.waitHours)),
    rule(
      'quality',
      t('follow.panel.quality'),
      t(`follow.panel.qualities.${value.qualityPreset}`),
    ),
    {
      id: 'stop',
      label: t('follow.panel.stop'),
      hint: t(
        value.profileCount > 1
          ? 'follow.panel.stopHintShared'
          : 'follow.panel.stopHint',
      ),
      selected: false,
    },
  )

  return list
})

const modeOptions = computed<PanelOption[]>(() =>
  FOLLOW_MODES.map(id => ({
    id,
    label: modeLabel(id),
    hint: t(
      `follow.panel.${series.value ? 'modeHints' : 'modeHintsMovie'}.${id}`,
    ),
    selected: id === follow.value.mode,
  })),
)

function studioOption(id: string): PanelOption {
  const name = studio.value
  const strict = follow.value.voiceStrict

  switch (id) {
    case 'prefer':
      return {
        id,
        label: name!,
        hint: t('follow.panel.voicePreferHint'),
        selected: !strict,
      }
    case 'only':
      return {
        id,
        label: t('follow.panel.voiceOnly', { studio: name }),
        hint: t('follow.panel.voiceOnlyHint'),
        selected: strict,
      }
    default:
      return {
        id,
        label: t('follow.panel.voiceAny'),
        // Ждать дубляж есть смысл, только пока студия не закреплена
        hint: t(
          name ? 'follow.panel.voiceAnyHint' : 'follow.panel.voiceUnknownHint',
        ),
        selected: !name,
      }
  }
}

// Правило другого языка одно на весь список: оно в подзаголовке шага, а не
// повтором под каждым языком
function languageOption(audio: string): PanelOption {
  return {
    id: audio,
    label: audioName(audio),
    hint:
      audio === 'original' ? t('follow.panel.voiceOriginalHint') : undefined,
    selected: follow.value.audio === audio,
  }
}

/**
 * Отметки двух групп независимы: язык — правило слежения, студия — правило
 * русской озвучки. Поэтому у русской «как у сервера» и студия отмечены вместе.
 */
const legacyVoiceOptions = computed<PanelOption[]>(() =>
  voiceChoices(follow.value, studio.value).map((id) => {
    if (id === 'server') {
      return {
        id,
        label: t('follow.panel.voiceServer', {
          language: audioName(follow.value.audioServer),
        }),
        hint: t('follow.panel.voiceServerHint'),
        selected: follow.value.audio === null,
      }
    }

    if (id === 'languages') {
      return {
        id,
        label: t('follow.panel.voiceOtherLanguage'),
        selected: false,
        detail: '›',
      }
    }

    return isFollowAudio(id) ? languageOption(id) : studioOption(id)
  }),
)

const languageOptions = computed<PanelOption[]>(() => [
  {
    id: 'server',
    label: t('follow.panel.voiceServer', {
      language: audioName(follow.value.audioServer),
    }),
    selected: follow.value.audio === null,
  },
  ...FOLLOW_AUDIOS.map(languageOption),
])
const voiceOptions = computed<PanelOption[]>(() => {
  if (!modern.value)
    return legacyVoiceOptions.value
  const policy = follow.value.voicePolicy!
  return [
    ...(policy.mode === 'legacy'
      ? [
          {
            id: 'legacy',
            label: t('follow.studio.legacy'),
            selected: true,
            disabled: true,
          },
        ]
      : []),
    ...(['auto', 'prefer', 'only', 'any'] as const).map(id => ({
      id,
      label: t(`follow.studio.${id}`),
      hint: t(`follow.studio.${id}Hint`),
      selected: policy.mode === id,
      detail:
        (id === 'prefer' || id === 'only') && policy.mode === id
          ? policy.studio
          : undefined,
    })),
  ]
})
const studioOptions = computed<PanelOption[]>(() => {
  const policy = follow.value.voicePolicy
  const saved = policy && 'studio' in policy ? policy.studio : undefined
  const names = [
    ...new Set(
      [
        saved,
        follow.value.voiceResolution?.studio,
        ...(voices.value?.items.map(item => item.studio) ?? []),
      ].filter((name): name is string => !!name),
    ),
  ]
  return [
    {
      id: 'refresh',
      label: t(
        loading.value
          ? 'follow.studio.searching'
          : voices.value?.updatedAt
            ? 'follow.studio.refresh'
            : 'follow.studio.find',
      ),
      selected: false,
      disabled: loading.value,
    },
    ...names.map((name) => {
      const item = voices.value?.items.find(item => item.studio === name)
      return {
        id: `studio:${name}`,
        label: name,
        selected: saved === name && policy?.mode === chosenMode.value,
        hint: t(item?.found ? 'follow.studio.found' : 'follow.studio.saved'),
        disabled: saving.value,
      }
    }),
  ]
})

const waitOptions = computed<PanelOption[]>(() =>
  waitChoices(follow.value.waitHours).map(hours => ({
    id: String(hours),
    label: texts.waitLabel(hours),
    selected: hours === follow.value.waitHours,
  })),
)

const qualityOptions = computed<PanelOption[]>(() =>
  QUALITY_PRESETS.map(id => ({
    id,
    label: t(`follow.panel.qualities.${id}`),
    // Верхняя ступень уже в подписи: подсказка — только запасные
    hint: t('follow.panel.qualityFallback', {
      steps: QUALITY_LADDERS[id].slice(1).map(qualityName).join(' → '),
    }),
    selected: id === follow.value.qualityPreset,
  })),
)

const options = computed(() => {
  switch (step.value) {
    case 'mode':
      return modeOptions.value
    case 'voice':
      return voiceOptions.value
    case 'language':
      return languageOptions.value
    case 'studio':
      return studioOptions.value
    case 'wait':
      return waitOptions.value
    case 'quality':
      return qualityOptions.value
    default:
      return mainOptions.value
  }
})

const panelTitle = computed(() =>
  step.value === 'main'
    ? props.title
    : step.value === 'studio' || step.value === 'voice'
      ? t('follow.studio.title')
      : t(`follow.panel.${step.value}`),
)

const subtitle = computed(() => {
  if (saveError.value)
    return t('follow.errors.save')
  if (saving.value)
    return t('follow.studio.saving')
  if (step.value === 'studio') {
    const data = voices.value
    return [
      t(series.value ? 'follow.studio.context' : 'follow.studio.contextMovie', {
        season: season.value,
      }),
      searchError.value ? t('follow.studio.error') : '',
      data?.failed.length ? t('follow.studio.partial') : '',
      data?.cache === 'miss' ? t('follow.studio.cacheMiss') : '',
      data?.updatedAt
        ? t('follow.studio.updated', {
            date: new Date(data.updatedAt).toLocaleString(),
          })
        : '',
      data?.stale ? t('follow.studio.stale') : '',
      data && !data.indexerCount ? t('follow.studio.noIndexers') : '',
      data?.updatedAt && !data.items.some(item => item.found)
        ? t('follow.studio.empty')
        : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (step.value === 'voice') {
    const resolution = follow.value.voiceResolution
    return [
      t('follow.studio.trackHint'),
      !modern.value ? t('follow.studio.oldServer') : '',
      !russian.value ? t('follow.studio.inactive') : '',
      resolution
        ? t(`follow.studio.sources.${resolution.source}`, {
            studio:
              resolution.studio
              ?? (resolution.type
                ? t(`sources.voiceTypes.${resolution.type}`)
                : ''),
            season: resolution.sourceSeason ?? resolution.season,
          })
        : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }

  if (step.value === 'wait')
    return t('follow.panel.waitHint')

  if (step.value === 'language') {
    return t('follow.panel.voiceLanguageHint')
  }

  if (step.value !== 'main')
    return props.title

  return [
    t('follow.panel.sharedRules'),
    editable.value
      ? texts.statusLine(follow.value) || texts.policyLine(props.view)
      : t('follow.panel.readOnly'),
  ]
    .filter(Boolean)
    .join(' · ')
})

function toMain(from = step.value) {
  if (from === 'main')
    returnTo.value = undefined
  else returnTo.value = from === 'studio' ? 'voice' : from

  step.value = 'main'
}

function voiceBody(id: string): FollowTitleInput {
  if (id === 'server')
    return { audio: null }

  if (isFollowAudio(id))
    return { audio: id }

  if (id === 'any')
    return { voiceStudio: null, voiceStrict: false }

  return { voiceStudio: studio.value, voiceStrict: id === 'only' }
}

function select(id: string) {
  if (saving.value || (!editable.value && id !== 'stop'))
    return
  saveError.value = false
  switch (step.value) {
    case 'main':
      if (id === 'stop') {
        emit('stop')
      }
      else if (editable.value) {
        returnTo.value = undefined
        step.value = id as Step
      }

      return
    case 'mode':
      void persist({ mode: id as (typeof FOLLOW_MODES)[number] })
      break
    case 'studio':
      if (id === 'refresh') {
        void loadVoices(true)
        return
      }
      if (id.startsWith('studio:')) {
        void persist({
          voicePolicy: { mode: chosenMode.value, studio: id.slice(7) },
        })
      }
      return
    case 'voice':
      if (modern.value) {
        if (id === 'prefer' || id === 'only') {
          chosenMode.value = id
          step.value = 'studio'
          returnTo.value = undefined
          void loadVoices()
        }
        else if (id === 'auto' || id === 'any') {
          void persist({ voicePolicy: { mode: id } })
        }
        return
      }
      if (id === 'languages') {
        returnTo.value = undefined
        step.value = 'language'
        return
      }

      void persist(voiceBody(id))
      break
    case 'language':
      void persist(voiceBody(id))
      break
    case 'wait':
      void persist({ waitHours: Number(id) })
      break
    case 'quality':
      void persist({ qualityPreset: id as (typeof QUALITY_PRESETS)[number] })
      break
  }
}

function back() {
  if (step.value === 'main') {
    emit('close')
  }
  else if (step.value === 'studio') {
    returnTo.value = chosenMode.value
    step.value = 'voice'
  }
  else {
    toMain()
  }
}
</script>

<template>
  <OptionsPanel
    :key="step"
    :title="panelTitle"
    :subtitle="subtitle"
    :options="options"
    :focus-selected="step !== 'main'"
    :focus-option="returnTo"
    @select="select"
    @close="back"
  />
</template>
