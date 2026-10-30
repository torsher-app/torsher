<script setup lang="ts">
import type {
  FollowTitleInput,
  TitleFollow,
  TitleFollowResponse,
} from '@torsher/api-client'
import type { PanelOption } from './OptionsPanel.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFollowTexts } from '../composables/useTitleFollow.ts'
import {
  FOLLOW_MODES,
  isFollowAudio,
  OTHER_AUDIOS,
  QUALITY_LADDERS,
  QUALITY_PRESETS,
  qualityName,
  voiceChoices,
  waitChoices,
} from '../lib/follow.ts'
import OptionsPanel from './OptionsPanel.vue'

// `language` — вложенный шаг «Озвучки»: другой язык при русской
type Step = 'main' | 'mode' | 'voice' | 'language' | 'wait' | 'quality'

/**
 * Лист правил «Следить»: пункты со значением справа, OK открывает шаг с
 * вариантами, выбор сразу уходит на сервер и возвращает к пунктам. Профиль,
 * которому правила не менять, видит их неактивными; «Не следить» есть всегда.
 */
const props = defineProps<{
  title: string
  view: TitleFollowResponse & { follow: TitleFollow }
}>()

const emit = defineEmits<{
  close: []
  save: [body: FollowTitleInput]
  stop: []
}>()

const { t } = useI18n()
const texts = useFollowTexts()

const step = ref<Step>('main')
// Возврат из шага — на пункт, который его открыл
const returnTo = ref<string>()

const follow = computed(() => props.view.follow)
const series = computed(() => follow.value.kind === 'series')
const editable = computed(() => props.view.canEdit)
const studio = computed(
  () => follow.value.voice?.studio ?? follow.value.voiceStudio ?? undefined,
)
// Студии и типы перевода есть только у русской озвучки
const russian = computed(() => follow.value.audioEffective === 'ru')

function audioName(audio: string) {
  return t(`audioLanguages.${audio}`)
}

function voiceValue() {
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
    rule('voice', t('follow.panel.voice'), voiceValue()),
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

function languageOption(audio: string): PanelOption {
  const hint
    = audio === 'original'
      ? t('follow.panel.voiceOriginalHint')
      : audio === 'ru'
        ? undefined
        : t('follow.panel.voiceLanguageHint')

  return {
    id: audio,
    label: audioName(audio),
    hint,
    selected: follow.value.audio === audio,
  }
}

/**
 * Отметки двух групп независимы: язык — правило слежения, студия — правило
 * русской озвучки. Поэтому у русской «как у сервера» и студия отмечены вместе.
 */
const voiceOptions = computed<PanelOption[]>(() =>
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

const languageOptions = computed<PanelOption[]>(() =>
  OTHER_AUDIOS.map(languageOption),
)

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
    case 'wait':
      return waitOptions.value
    case 'quality':
      return qualityOptions.value
    default:
      return mainOptions.value
  }
})

const panelTitle = computed(() =>
  step.value === 'main' ? props.title : t(`follow.panel.${step.value}`),
)

const subtitle = computed(() => {
  if (step.value === 'wait')
    return t('follow.panel.waitHint')

  if (step.value !== 'main')
    return props.title

  return editable.value
    ? texts.statusLine(follow.value) || texts.policyLine(props.view)
    : t('follow.panel.readOnly')
})

function toMain() {
  if (step.value === 'main')
    returnTo.value = undefined
  else returnTo.value = step.value === 'language' ? 'voice' : step.value

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
      emit('save', { mode: id as (typeof FOLLOW_MODES)[number] })
      break
    case 'voice':
      if (id === 'languages') {
        returnTo.value = undefined
        step.value = 'language'
        return
      }

      emit('save', voiceBody(id))
      break
    case 'language':
      emit('save', voiceBody(id))
      break
    case 'wait':
      emit('save', { waitHours: Number(id) })
      break
    case 'quality':
      emit('save', { qualityPreset: id as (typeof QUALITY_PRESETS)[number] })
      break
  }

  toMain()
}

function back() {
  if (step.value === 'main') {
    emit('close')
  }
  else if (step.value === 'language') {
    returnTo.value = 'languages'
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
    :focus-option="step === 'main' || step === 'voice' ? returnTo : undefined"
    @select="select"
    @close="back"
  />
</template>
