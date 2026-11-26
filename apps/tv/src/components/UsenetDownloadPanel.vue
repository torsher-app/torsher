<script setup lang="ts">
import type { TitleUsenetSources, UsenetJob } from '@torsher/api-client'
import type { PanelOption } from './OptionsPanel.vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.ts'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import { useFocus } from '../focus/index.ts'
import { captureTitleViewer, isTitleViewer } from '../titleActions.ts'
import OptionsPanel from './OptionsPanel.vue'

const props = defineProps<{
  titleId: string
  title: string
  season?: number
  episode?: number
}>()
const emit = defineEmits<{ close: [], imported: [] }>()
const { t } = useI18n()
const focus = useFocus()
const { sizeLabel } = useSourceLabels()
const viewer = captureTitleViewer()
const controller = new AbortController()
const items = shallowRef<TitleUsenetSources['items']>([])
const job = shallowRef<UsenetJob>()
const loading = ref(true)
const submitting = ref<string>()
const failed = ref(false)
let polling = false

const stateKeys: Record<UsenetJob['state'], string> = {
  pending: 'panel.torrents.states.queued',
  submitting: 'panel.torrents.states.queued',
  queued: 'panel.torrents.states.queued',
  downloading: 'panel.torrents.states.downloading',
  postProcessing: 'usenet.postProcessing',
  paused: 'panel.torrents.states.paused',
  importing: 'usenet.importing',
  imported: 'download.state.library',
  failed: 'state.unknown.title',
  attention: 'panel.torrents.groups.attention',
  released: 'panel.torrents.groups.idle',
}

function alive() {
  return !controller.signal.aborted && isTitleViewer(viewer)
}

function stateLabel(value: UsenetJob) {
  return value.state === 'downloading' && value.progress !== null
    ? t('download.state.downloading', { n: Math.round(value.progress * 100) })
    : t(stateKeys[value.state])
}

function inProgress(value: UsenetJob) {
  return (
    value.state !== 'imported'
    && value.state !== 'released'
    && value.state !== 'failed'
  )
}

const title = computed(() =>
  [
    t('usenet.downloads'),
    props.episode === undefined
      ? props.title
      : `S${props.season}E${props.episode} · ${props.title}`,
  ].join(' · '),
)

const subtitle = computed(() => {
  if (failed.value)
    return t('state.unknown.title')
  if (job.value)
    return stateLabel(job.value)
  return !loading.value && !items.value.length
    ? t('sources.empty.nothing.title')
    : undefined
})

const options = computed<PanelOption[]>(() => {
  const choices = !job.value
    ? items.value.map(item => ({
        id: item.id,
        label: item.title,
        hint: [item.source, item.quality, item.size && sizeLabel(item.size)]
          .filter(Boolean)
          .join(' · '),
        detail: t(
          submitting.value === item.id
            ? 'panel.torrents.states.queued'
            : 'follow.policy.download',
        ),
        disabled: !!submitting.value,
        selected: false,
      }))
    : []

  if (
    failed.value
    && !loading.value
    && (!job.value || !inProgress(job.value))
  ) {
    choices.unshift({
      id: 'retry',
      label: t('state.retry'),
      selected: false,
      hint: '',
      detail: '',
      disabled: false,
    })
  }

  return [
    ...choices,
    { id: 'close', label: t('panel.common.close'), selected: false },
  ]
})

async function refreshJob() {
  const { items: queue } = await api.titles.getTitleUsenetJobs(props.titleId, {
    signal: controller.signal,
  })
  if (!alive())
    return
  const existing = job.value
  const target = queue.filter(
    item =>
      item.season === (props.season ?? 0)
      && item.episode === (props.episode ?? 0),
  )
  const current = existing
    ? target.find(item => item.id === existing.id)
    : (target.find(inProgress)
      ?? target.find(item => item.state === 'imported' && item.mediaFileId))
  if (current) {
    job.value = current
    if (current.state === 'imported' && existing?.state !== 'imported')
      emit('imported')
    if (current.state === 'failed' || current.state === 'released')
      failed.value = true
  }
}

async function search() {
  if (polling)
    return
  loading.value = true
  polling = true
  failed.value = false
  job.value = undefined
  try {
    await refreshJob()
    if (!alive() || job.value)
      return
    const results = await api.titles.getTitleUsenetSources(
      props.titleId,
      {
        season: props.season?.toString(),
        episode: props.episode?.toString(),
      },
      { signal: controller.signal },
    )
    if (alive()) {
      items.value = results.items
      failed.value = results.failed && !results.items.length
    }
  }
  catch {
    if (alive())
      failed.value = true
  }
  finally {
    polling = false
    loading.value = false
    nextTick(() => {
      if (
        alive()
        && focus.current()?.dataset.option === 'close'
        && items.value.length
      ) {
        const first = document.querySelector<HTMLElement>(
          `[data-option="${items.value[0]?.id}"]`,
        )
        if (first)
          focus.focusOn(first)
      }
    })
  }
}

async function submit(candidateId: string) {
  if (candidateId === 'close') {
    emit('close')
    return
  }
  if (candidateId === 'retry') {
    void search()
    return
  }
  if (!alive() || submitting.value || job.value)
    return
  submitting.value = candidateId
  failed.value = false
  try {
    const created = await api.titles.postTitleUsenetJob(
      props.titleId,
      {
        candidateId,
        season: props.season,
        episode: props.episode,
      },
      { signal: controller.signal },
    )
    if (alive()) {
      job.value = created
      if (created.state === 'failed' || created.state === 'released')
        failed.value = true
      if (created.state === 'imported')
        emit('imported')
      nextTick(() => {
        if (alive())
          focus.activate('options-panel')
      })
    }
  }
  catch {
    if (alive()) {
      failed.value = true
      // The server may have created a job before the connection was lost.
      await refreshJob().catch(() => {})
    }
  }
  finally {
    submitting.value = undefined
  }
}

const timer = setInterval(async () => {
  if (!alive() || !job.value || !inProgress(job.value) || polling)
    return
  polling = true
  try {
    await refreshJob()
  }
  catch {
  }
  finally {
    polling = false
  }
}, 5000)

onMounted(search)
onBeforeUnmount(() => {
  controller.abort()
  clearInterval(timer)
})
</script>

<template>
  <OptionsPanel
    :title="title"
    :subtitle="subtitle"
    :options="options"
    :focus-selected="false"
    :aria-busy="loading || !!submitting"
    @select="submit"
    @close="emit('close')"
  />
</template>
