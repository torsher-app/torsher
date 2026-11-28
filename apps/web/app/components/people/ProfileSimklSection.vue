<script setup lang="ts">
import { getErrorStatus } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatDateTime } from '~/lib/format'
import { api } from '~/services/api'

const { profileId } = defineProps<{ profileId: string }>()
const { t, locale } = useI18n()
const labelId = useId()

type Status = Awaited<ReturnType<typeof api.profiles.getProfileSimkl>>
const status = shallowRef<Status>()
const busy = ref(false)
const error = ref(false)
const pull = ref(false)
const push = ref(false)
const confirmRescan = ref(false)
const connection = computed(() => status.value?.connection)
const challenge = computed(() => status.value?.challenge)
const dirty = computed(() => !!connection.value && (
  pull.value !== connection.value.pull || push.value !== connection.value.push
))
let timer: ReturnType<typeof setTimeout> | undefined
let version = 0
let refreshUntil = 0

function update(next: Status, resetDirections: boolean) {
  const bindingChanged = status.value?.connection?.generation !== next.connection?.generation
  status.value = next
  if (resetDirections || bindingChanged) {
    pull.value = next.connection?.pull ?? false
    push.value = next.connection?.push ?? false
  }
}

function schedule() {
  clearTimeout(timer)
  if (challenge.value) {
    const wait = Date.parse(challenge.value.nextPollAt) - Date.now()
    timer = setTimeout(() => run(() => api.profiles.postProfileSimklDevicePoll(profileId), false, false), Math.max(1000, wait || 0))
  }
  else if (status.value?.syncing || (status.value?.pending && Date.now() < refreshUntil)) {
    timer = setTimeout(() => run(() => api.profiles.getProfileSimkl(profileId), false, false), 2500)
  }
}

async function run(load: () => Promise<Status>, resetDirections = true, showBusy = true) {
  clearTimeout(timer)
  const request = ++version
  error.value = false
  if (showBusy)
    busy.value = true
  try {
    const next = await withErrorMode('silent', load)
    if (request === version) {
      update(next, resetDirections)
      schedule()
    }
  }
  catch (failure) {
    if (request !== version)
      return
    error.value = true
    const code = getErrorStatus(failure)
    const pollingDevice = !showBusy && !!challenge.value
    if (pollingDevice || code === 409) {
      const current = await withErrorMode('silent', () => api.profiles.getProfileSimkl(profileId))
        .catch(() => undefined)
      if (request !== version)
        return
      if (current) {
        update(current, code === 409)
        schedule()
        return
      }
    }
    if (pollingDevice && (code === 409 || code === 422 || code === 404)) {
      if (status.value)
        status.value = { ...status.value, challenge: null }
      return
    }
    if (pollingDevice)
      timer = setTimeout(() => run(() => api.profiles.getProfileSimkl(profileId), false, false), 3000)
  }
  finally {
    if (request === version)
      busy.value = false
  }
}

function authorize(scope: 'read' | 'write') {
  return run(() => api.profiles.postProfileSimklDevice(profileId, { scope }), false)
}

function cancelAuthorization() {
  return run(() => api.profiles.deleteProfileSimklDevice(profileId))
}

function disconnect() {
  return run(() => api.profiles.deleteProfileSimkl(profileId))
}

function save() {
  const target = connection.value
  if (!target)
    return
  if (push.value && target.scope !== 'write')
    return authorize('write')
  return run(() => api.profiles.patchProfileSimkl(profileId, {
    expectedGeneration: target.generation,
    pull: pull.value,
    push: push.value,
  }))
}

function sync(mode: 'auto' | 'manual' | 'full') {
  confirmRescan.value = false
  refreshUntil = Date.now() + 30_000
  return run(() => api.profiles.postProfileSimklSync(profileId, { mode }), false, mode !== 'auto')
}

function retry() {
  refreshUntil = Date.now() + 30_000
  return run(() => api.profiles.postProfileSimklRetry(profileId), false)
}

onMounted(async () => {
  refreshUntil = Date.now() + 30_000
  await run(() => api.profiles.getProfileSimkl(profileId), true, false)
  if (!challenge.value && connection.value?.pull && !connection.value.reauthorize)
    void sync('auto')
})
onBeforeUnmount(() => {
  version++
  clearTimeout(timer)
})
</script>

<template>
  <section v-if="status?.available || status?.connection" :aria-labelledby="`${labelId}-title`" class="grid gap-3 border-t pt-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 :id="`${labelId}-title`" class="text-[13.5px] font-medium">
        {{ t('panel.simklSync.title') }}
      </h3>
      <LoadingButton
        v-if="status.available && !connection && !challenge"
        size="xs"
        variant="outline"
        :loading="busy"
        @click="authorize('read')"
      >
        {{ t('panel.simklSync.connect') }}
      </LoadingButton>
    </div>

    <p class="text-sm text-muted-foreground">
      {{ t('panel.simklSync.limits') }}
    </p>
    <Alert v-if="error || status.syncError" variant="destructive" role="alert">
      <AlertDescription>{{ t('panel.simklSync.failed') }}</AlertDescription>
    </Alert>
    <Alert v-if="status.revokeWarning" role="status">
      <AlertDescription>{{ t('panel.simklSync.revokeWarning') }}</AlertDescription>
    </Alert>
    <div v-if="challenge" class="grid gap-2 text-sm">
      <p role="status" class="text-muted-foreground">
        {{ t('panel.simklSync.waiting') }}
      </p>
      <p class="font-medium" translate="no">
        {{ t('panel.simklSync.code', { code: challenge.userCode }) }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button as-child size="xs" variant="outline">
          <a :href="challenge.verificationUri" target="_blank" rel="noopener noreferrer">
            {{ t('panel.simklSync.open') }}
          </a>
        </Button>
        <Button size="xs" variant="ghost" :disabled="busy" @click="cancelAuthorization">
          {{ t('panel.common.cancel') }}
        </Button>
      </div>
    </div>

    <div v-else-if="connection" class="grid gap-3">
      <p class="break-words text-sm">
        {{ t('panel.simklSync.account', { account: connection.account }) }}
      </p>
      <template v-if="connection.reauthorize">
        <p class="text-sm text-muted-foreground" role="status">
          {{ t('panel.simklSync.reauthorize') }}
        </p>
        <LoadingButton v-if="status.available" size="xs" variant="outline" class="w-fit" :loading="busy" @click="authorize(connection.scope)">
          {{ t('panel.simklSync.connect') }}
        </LoadingButton>
      </template>
      <template v-else>
        <fieldset class="grid gap-2" :disabled="busy">
          <div class="flex items-center gap-2">
            <Checkbox :id="`${labelId}-pull`" :model-value="pull" @update:model-value="pull = $event === true" />
            <Label :for="`${labelId}-pull`">{{ t('panel.simklSync.pull') }}</Label>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox :id="`${labelId}-push`" :model-value="push" @update:model-value="push = $event === true" />
            <Label :for="`${labelId}-push`">{{ t('panel.simklSync.push') }}</Label>
          </div>
          <p v-if="push && !connection.push" class="text-sm text-muted-foreground">
            {{ t('panel.simklSync.consent') }}
          </p>
          <LoadingButton v-if="dirty" size="xs" class="w-fit" :loading="busy" @click="save">
            {{ t('panel.common.save') }}
          </LoadingButton>
        </fieldset>
        <ul v-if="connection.pull || connection.push" role="status" class="grid gap-1 text-sm text-muted-foreground">
          <li v-if="status.syncing">
            {{ t('panel.simklSync.syncing') }}
          </li>
          <li v-else-if="status.lastSyncAt">
            {{ t('panel.simklSync.lastSync', { time: formatDateTime(status.lastSyncAt, locale) }) }}
          </li>
          <li v-else-if="connection.pull">
            {{ t('panel.simklSync.neverSynced') }}
          </li>
          <li v-if="status.pending">
            {{ t('panel.simklSync.pending', { pending: status.pending }) }}
          </li>
          <li v-if="status.issues">
            {{ t('panel.simklSync.issues', { issues: status.issues }) }}
          </li>
          <li v-if="status.skipped">
            {{ t('panel.simklSync.skipped', { skipped: status.skipped }) }}
          </li>
        </ul>
        <div v-if="connection.pull || status.issues" class="flex flex-wrap gap-2">
          <Button v-if="connection.pull" size="xs" variant="outline" :disabled="busy || status.syncing" @click="sync('manual')">
            {{ t('panel.simklSync.sync') }}
          </Button>
          <Button v-if="connection.pull && !confirmRescan" size="xs" variant="outline" :disabled="busy || status.syncing" @click="confirmRescan = true">
            {{ t('panel.simklSync.rescan') }}
          </Button>
          <Button v-if="connection.push && status.issues" size="xs" variant="outline" :disabled="busy || status.syncing" @click="retry">
            {{ t('panel.simklSync.retry') }}
          </Button>
        </div>
        <div v-if="confirmRescan && connection.pull" class="flex flex-wrap items-center gap-2 text-sm">
          <Button size="xs" :disabled="busy || status.syncing" @click="sync('full')">
            {{ t('panel.simklSync.rescan') }}
          </Button>
          <Button size="xs" variant="ghost" @click="confirmRescan = false">
            {{ t('panel.common.cancel') }}
          </Button>
        </div>
      </template>
      <Button size="xs" variant="outline" class="w-fit" :disabled="busy" @click="disconnect">
        {{ t('panel.simklSync.disconnect') }}
      </Button>
    </div>
  </section>
</template>
