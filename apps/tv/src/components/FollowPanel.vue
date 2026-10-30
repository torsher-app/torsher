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
  QUALITY_LADDERS,
  QUALITY_PRESETS,
  qualityName,
  waitChoices,
} from '../lib/follow.ts'
import OptionsPanel from './OptionsPanel.vue'

type Step = 'main' | 'mode' | 'voice' | 'wait' | 'quality'

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
const returnTo = ref<Step>()

const follow = computed(() => props.view.follow)
const series = computed(() => follow.value.kind === 'series')
const editable = computed(() => props.view.canEdit)
const studio = computed(
  () => follow.value.voice?.studio ?? follow.value.voiceStudio ?? undefined,
)

function voiceValue() {
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

const voiceOptions = computed<PanelOption[]>(() => {
  const name = studio.value

  if (!name) {
    return [
      {
        id: 'any',
        label: t('follow.panel.voiceAny'),
        hint: t('follow.panel.voiceUnknownHint'),
        selected: true,
      },
    ]
  }

  const strict = follow.value.voiceStrict

  return [
    {
      id: 'prefer',
      label: name,
      hint: t('follow.panel.voicePreferHint'),
      selected: !strict,
    },
    {
      id: 'only',
      label: t('follow.panel.voiceOnly', { studio: name }),
      hint: t('follow.panel.voiceOnlyHint'),
      selected: strict,
    },
    {
      id: 'any',
      label: t('follow.panel.voiceAny'),
      hint: t('follow.panel.voiceAnyHint'),
      selected: false,
    },
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
  returnTo.value = step.value === 'main' ? undefined : step.value
  step.value = 'main'
}

function voiceBody(id: string): FollowTitleInput {
  if (id === 'any')
    return { voiceStudio: null, voiceStrict: false }

  return { voiceStudio: studio.value, voiceStrict: id === 'only' }
}

function select(id: string) {
  switch (step.value) {
    case 'main':
      if (id === 'stop')
        emit('stop')
      else if (editable.value)
        step.value = id as Step

      return
    case 'mode':
      emit('save', { mode: id as (typeof FOLLOW_MODES)[number] })
      break
    case 'voice':
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
  if (step.value === 'main')
    emit('close')
  else toMain()
}
</script>

<template>
  <OptionsPanel
    :key="step"
    :title="panelTitle"
    :subtitle="subtitle"
    :options="options"
    :focus-selected="step !== 'main'"
    :focus-option="step === 'main' ? returnTo : undefined"
    @select="select"
    @close="back"
  />
</template>
