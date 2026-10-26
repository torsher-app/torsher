<script setup lang="ts">
import type { ActiveDownload } from '../lib/downloadSlot.ts'
import type { PanelOption } from './OptionsPanel.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloadTexts } from '../composables/useTitleDownload.ts'
import OptionsPanel from './OptionsPanel.vue'

/**
 * Закачка выбранного объёма (фильм или сезон): какая раздача, сколько
 * скачано, пиры и скорость. «Отменить загрузку» — только этой раздачи, пока
 * она качается; другая раздача — те же «Источники», что у «Смотреть», если
 * на сервере есть источники (`canPick`).
 */
const props = defineProps<{
  title: string
  series: boolean
  season?: number
  download: ActiveDownload
  canPick: boolean
}>()

const emit = defineEmits<{
  close: []
  cancel: [torrentId: string]
  pick: []
}>()

const { t } = useI18n()
const texts = useDownloadTexts()

const statusLine = computed(() =>
  [texts.activeLabel(props.download), texts.activeHint(props.download)]
    .filter(Boolean)
    .join(' · '),
)

const options = computed<PanelOption[]>(() => {
  const list: PanelOption[] = []

  if (props.download.phase === 'downloading') {
    list.push({
      id: 'cancel',
      label: t('download.cancel'),
      hint: t('download.cancelHint'),
      selected: false,
    })
  }

  if (!props.canPick)
    return list

  list.push({
    id: 'pick',
    label: props.series
      ? t('download.season', { n: props.season ?? 1 })
      : t('download.other'),
    selected: false,
    detail: '›',
  })

  return list
})

function select(id: string) {
  if (id === 'cancel')
    emit('cancel', props.download.torrentId)
  else emit('pick')
}
</script>

<template>
  <OptionsPanel
    :title="title"
    :subtitle="statusLine"
    :options="options"
    :focus-selected="false"
    @select="select"
    @close="emit('close')"
  />
</template>
