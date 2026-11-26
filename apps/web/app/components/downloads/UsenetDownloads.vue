<script setup lang="ts">
import type { UsenetJob } from '@torsher/api-client'
import { getErrorStatus } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import ListGroup from '~/components/ListGroup.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import { api } from '~/services/api'

const { t } = useI18n()
const statusKeys: Record<UsenetJob['state'], string> = {
  pending: 'panel.torrents.states.queued',
  submitting: 'panel.torrents.states.queued',
  queued: 'panel.torrents.states.queued',
  downloading: 'panel.torrents.states.downloading',
  postProcessing: 'usenet.postProcessing',
  paused: 'panel.torrents.states.paused',
  importing: 'usenet.importing',
  imported: 'download.state.library',
  failed: 'panel.overview.attention.error',
  attention: 'panel.torrents.groups.attention',
  released: 'panel.torrents.groups.idle',
}

const items = shallowRef<UsenetJob[]>([])
const pending = ref<string>()
const releaseTarget = shallowRef<UsenetJob>()
const failed = ref(false)
const releaseOpen = computed({
  get: () => !!releaseTarget.value,
  set(value) {
    if (!value)
      releaseTarget.value = undefined
  },
})
let loading = false
let unsupported = false
let hasLoaded = false
let timer: ReturnType<typeof setInterval> | undefined
let generation = 0

function status(job: UsenetJob) {
  if (job.problem === 'path_unreadable')
    return t('usenet.pathUnreadable')
  if (job.problem === 'insufficient_space')
    return t('follow.episode.no_space')
  if (
    job.problem
    && ['auth', 'address_changed', 'unavailable', 'unsupported_version'].includes(
      job.problem,
    )
  ) {
    return t('usenet.checkFailed')
  }
  return job.state === 'downloading' && job.progress !== null
    ? t('download.state.downloading', { n: Math.round(job.progress * 100) })
    : t(statusKeys[job.state])
}

async function load() {
  if (loading || unsupported || pending.value)
    return
  const expected = generation
  loading = true
  try {
    const result = await withErrorMode('silent', () =>
      api.usenet.getUsenetJobs())
    if (expected === generation) {
      items.value = result.items
      hasLoaded = true
      failed.value = false
    }
  }
  catch (error) {
    if (getErrorStatus(error) === 404) {
      unsupported = true
      clearInterval(timer)
      return
    }
    if (expected === generation && hasLoaded)
      failed.value = true
  }
  finally {
    loading = false
  }
}

async function change(job: UsenetJob, release: boolean) {
  if (pending.value)
    return
  generation++
  pending.value = job.id
  failed.value = false
  try {
    const updated = await withErrorMode('silent', () =>
      release
        ? api.usenet.postUsenetRelease(job.id)
        : api.usenet.postUsenetReconcile(job.id))
    items.value = items.value.map(item =>
      item.id === updated.id ? updated : item,
    )
    releaseTarget.value = undefined
  }
  catch {
    failed.value = true
  }
  finally {
    pending.value = undefined
  }
}

onMounted(() => {
  void load()
  timer = setInterval(load, 10_000)
})
onBeforeUnmount(() => {
  generation++
  clearInterval(timer)
})
</script>

<template>
  <section v-if="items.length" :aria-label="t('usenet.downloads')">
    <ListGroup :title="t('usenet.downloads')">
      <template #meta>
        {{ items.length }}
      </template>
    </ListGroup>
    <Alert v-if="failed" variant="destructive">
      <AlertDescription>{{ t("usenet.checkFailed") }}</AlertDescription>
    </Alert>
    <ul>
      <li
        v-for="job in items"
        :key="job.id"
        class="grid gap-2 border-b px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium break-all">
            {{ job.releaseTitle }}
          </p>
          <p class="text-xs text-muted-foreground">
            <template v-if="job.episode > 0">
              S{{ job.season }}E{{ job.episode }} ·
            </template>
            {{ status(job) }}
          </p>
        </div>
        <div v-if="job.state === 'attention'" class="flex flex-wrap gap-2">
          <LoadingButton
            size="sm"
            variant="outline"
            :loading="pending === job.id && !releaseTarget"
            :disabled="!!pending"
            @click="change(job, false)"
          >
            {{ t("usenet.reconcile") }}
          </LoadingButton>
          <Button
            size="sm"
            variant="ghost"
            :disabled="!!pending"
            @click="releaseTarget = job"
          >
            {{ t("usenet.release") }}
          </Button>
        </div>
      </li>
    </ul>
    <AlertDialog v-model:open="releaseOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("usenet.release") }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("usenet.releaseDescription") }}
            <code v-if="releaseTarget" class="mt-2 block select-all break-all">
              torsher-{{ releaseTarget.id }}
            </code>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert v-if="failed" variant="destructive">
          <AlertDescription>{{ t("usenet.checkFailed") }}</AlertDescription>
        </Alert>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="!!pending">
            {{ t("panel.common.cancel") }}
          </AlertDialogCancel>
          <LoadingButton
            variant="destructive"
            :loading="!!pending"
            :disabled="!releaseTarget"
            @click="releaseTarget && change(releaseTarget, true)"
          >
            {{ t("usenet.release") }}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
