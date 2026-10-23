<script setup lang="ts">
import type { ReleaseCard } from '@torsher/api-client'
import type { PanelOption } from './OptionsPanel.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { suggestionName } from '../lib/release.ts'
import OptionsPanel from './OptionsPanel.vue'

/**
 * Что сделать с нераспознанной раздачей: подтвердить подсказку, найти тайтл
 * поиском или убрать из ряда как «не фильм и не сериал»
 */
const props = defineProps<{
  release: ReleaseCard
  subtitle: string
}>()

const emit = defineEmits<{
  close: []
  confirm: [titleId: string]
  search: []
  ignore: []
}>()

const { t } = useI18n()

const options = computed<PanelOption[]>(() => {
  const suggestion = props.release.suggestion

  return [
    ...(suggestion
      ? [
          {
            id: 'confirm',
            label: t('release.confirm', { title: suggestionName(suggestion) }),
            selected: false,
          },
        ]
      : []),
    { id: 'search', label: t('release.search'), selected: false, detail: '›' },
    {
      id: 'ignore',
      label: t('release.ignore'),
      hint: t('release.ignoreHint'),
      selected: false,
    },
  ]
})

function select(id: string) {
  if (id === 'confirm' && props.release.suggestion)
    emit('confirm', props.release.suggestion.id)
  else if (id === 'search')
    emit('search')
  else if (id === 'ignore')
    emit('ignore')
}
</script>

<template>
  <OptionsPanel
    :title="release.name"
    :subtitle="subtitle"
    :options="options"
    :focus-selected="false"
    @select="select"
    @close="emit('close')"
  />
</template>
