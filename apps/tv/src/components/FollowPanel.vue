<script setup lang="ts">
import type {
  FollowCursor,
  FollowTitleInput,
  TitleFollow,
  TitleFollowResponse,
} from '@torsher/api-client'
import type { PanelOption } from './OptionsPanel.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFollowTexts } from '../composables/useTitleFollow.ts'
import {
  CURSOR_PRESETS,
  cursorPreset,
  QUALITY_LADDERS,
  QUALITY_PRESETS,
  qualityName,
  waitChoices,
} from '../lib/follow.ts'
import OptionsPanel from './OptionsPanel.vue'

type Step = 'main' | 'start' | 'voice' | 'wait' | 'quality'

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
const preset = computed(() =>
  cursorPreset(follow.value.start, props.view.options),
)
const studio = computed(
  () => follow.value.voice?.studio ?? follow.value.voiceStudio ?? undefined,
)

function code(cursor: FollowCursor) {
  return `S${cursor.season}E${cursor.episode}`
}

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

const mainOptions = computed<PanelOption[]>(() => {
  const value = follow.value
  const list: PanelOption[] = []

  if (series.value)
    list.push(rule('start', t('follow.panel.start'), code(value.start)))

  list.push(
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
      hint: t('follow.panel.stopHint'),
      selected: false,
    },
  )

  return list
})

const startOptions = computed<PanelOption[]>(() => {
  const options = props.view.options
  const list: PanelOption[] = options
    ? CURSOR_PRESETS.map(id => ({
        id,
        label: t(`follow.panel.starts.${id}`),
        hint: code(options[id]),
        selected: preset.value === id,
      }))
    : []

  // Курсор из панели: выбора серии на ТВ нет, но текущее значение видно
  if (!preset.value) {
    list.push({
      id: 'custom',
      label: t('follow.panel.starts.custom', {
        code: code(follow.value.start),
      }),
      selected: true,
    })
  }

  return list
})

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
    hint: QUALITY_LADDERS[id].map(qualityName).join(' → '),
    selected: id === follow.value.qualityPreset,
  })),
)

const options = computed(() => {
  switch (step.value) {
    case 'start':
      return startOptions.value
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
    case 'start':
      if (id !== 'custom')
        emit('save', { start: id as (typeof CURSOR_PRESETS)[number] })
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
