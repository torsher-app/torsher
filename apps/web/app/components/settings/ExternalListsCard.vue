<script setup lang="ts">
import type { ExternalList, ExternalLists } from '~/lib/externalLists'
import { getErrorStatus } from '@torsher/api-client'
import { ExternalLinkIcon } from '@lucide/vue'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import {
  externalListsKey as base,
  externalListErrorKey,
  externalListRequestError,
} from '~/lib/externalLists'
import { formatDateTime } from '~/lib/format'
import { api } from '~/services/api'
import ExternalListDialog from './ExternalListDialog.vue'
import ExternalListExclusionsDialog from './ExternalListExclusionsDialog.vue'
import SettingsCard from './SettingsCard.vue'

const { t, locale } = useI18n()
const { profiles, state: profilesState, load: loadProfiles } = useProfiles()
const data = shallowRef<ExternalLists>()
const loading = ref(true)
const missing = ref(false)
const problem = ref<string>()
const busy = ref(false)
const editOpen = ref(false)
const editTarget = shallowRef<ExternalList | null>(null)
const exclusionsOpen = ref(false)
const removal = shallowRef<'key' | ExternalList>()
const removalOpen = computed({
  get: () => removal.value !== undefined,
  set: (open) => {
    if (!open)
      removal.value = undefined
  },
})
const { defineField, handleSubmit, resetForm, isSubmitting } = useForm({
  initialValues: { key: '' },
})
const [key, keyAttrs] = defineField('key')
const keyId = useId()
const profilesById = computed(
  () => new Map(profiles.value.map(profile => [profile.id, profile.name])),
)
const temporarilyBusy = computed(() => busy.value || isSubmitting.value)
let mounted = true
let requestVersion = 0
let refreshTimer: ReturnType<typeof setTimeout> | undefined

function scheduleRefresh() {
  clearTimeout(refreshTimer)
  if (!mounted || !data.value?.lists.some(list => !list.paused))
    return

  refreshTimer = setTimeout(
    () => void load(true),
    data.value.lists.some(list => list.running) ? 1000 : 30000,
  )
}

async function load(background = false) {
  const current = ++requestVersion
  if (!background) {
    loading.value = !data.value
    problem.value = undefined
  }
  try {
    const next = await withErrorMode('silent', () =>
      api.settings.getExternalLists())
    if (mounted && current === requestVersion) {
      data.value = next
      if (profilesState.value === 'idle')
        void loadProfiles()
    }
  }
  catch (error) {
    const message = await externalListRequestError(error)
    if (mounted && current === requestVersion && !background) {
      missing.value = !data.value && getErrorStatus(error) === 404
      if (!missing.value)
        problem.value = message
    }
  }
  finally {
    if (current === requestVersion) {
      loading.value = false
      scheduleRefresh()
    }
  }
}

async function change(action: () => Promise<unknown>) {
  if (busy.value)
    return

  busy.value = true
  problem.value = undefined
  clearTimeout(refreshTimer)
  requestVersion++
  try {
    await withErrorMode('silent', action)
    await load()
  }
  catch (error) {
    problem.value = await externalListRequestError(error)
    scheduleRefresh()
  }
  finally {
    busy.value = false
  }
}

const saveKey = handleSubmit(async ({ key }) => {
  const value = key.trim()
  if (!value)
    return

  await change(async () => {
    await api.settings.putExternalListKey({ apiKey: value })
    resetForm()
  })
})

function edit(list: ExternalList | null) {
  editTarget.value = list
  editOpen.value = true
}

function run(list: ExternalList) {
  return change(() => api.settings.runExternalList(list.id))
}

function togglePause(list: ExternalList) {
  return change(() =>
    api.settings.patchExternalList(list.id, { paused: !list.paused }),
  )
}

function remove() {
  const target = removal.value
  if (target === 'key') {
    void change(async () => {
      await api.settings.putExternalListKey({ apiKey: null })
      resetForm()
    })
  }
  else if (target) {
    void change(() => api.settings.deleteExternalList(target.id))
  }
}

function listStatus(list: ExternalList) {
  if (list.running)
    return 'running'
  if (list.paused)
    return 'paused'
  if (!list.lastResult)
    return 'waiting'
  if (list.lastResult.status === 'complete')
    return 'active'

  return list.lastResult.status
}

function runTime(value: number) {
  return formatDateTime(new Date(value).toISOString(), locale.value)
}

onMounted(() => void load())
onBeforeUnmount(() => {
  mounted = false
  clearTimeout(refreshTimer)
})
</script>

<template>
  <Skeleton v-if="loading" class="h-36 rounded-xl" aria-busy="true" />
  <SettingsCard
    v-else-if="!missing"
    :title="t(`${base}.title`)"
    :description="t(`${base}.description`)"
  >
    <Alert v-if="problem" variant="destructive" role="alert">
      <AlertDescription>{{ t(problem) }}</AlertDescription>
      <Button v-if="!data" size="sm" variant="outline" @click="load()">
        {{ t("panel.common.retry") }}
      </Button>
    </Alert>
    <template v-if="data">
      <form
        class="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
        novalidate
        @submit="saveKey"
      >
        <div class="grid gap-2">
          <Label :for="keyId">{{ t(`${base}.key`) }}</Label>
          <SecretInput
            :id="keyId"
            v-model="key"
            v-bind="keyAttrs"
            autocomplete="off"
            :disabled="temporarilyBusy"
            :maxlength="256"
            :placeholder="data.hasKey ? '••••••••••••••••' : undefined"
            :show-label="t('panel.common.showKey')"
            :hide-label="t('panel.common.hideKey')"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <LoadingButton
            type="submit"
            :loading="isSubmitting"
            :disabled="!key.trim() || temporarilyBusy"
          >
            {{ t("panel.common.save") }}
          </LoadingButton>
          <Button
            v-if="data.hasKey"
            type="button"
            variant="outline"
            :disabled="temporarilyBusy"
            @click="removal = 'key'"
          >
            {{ t(`${base}.removeKey`) }}
          </Button>
        </div>
      </form>
      <p v-if="data.keyRejected" class="text-sm text-destructive" role="alert">
        {{ t(`${base}.errors.keyRejected`) }}
      </p>
      <p v-else class="text-sm text-muted-foreground">
        {{ t(`${base}.${data.hasKey ? "keySaved" : "errors.keyRequired"}`) }}
      </p>
      <Alert
        v-if="profilesState === 'error'"
        variant="destructive"
        role="alert"
      >
        <AlertDescription>{{ t(`${base}.errors.generic`) }}</AlertDescription>
        <Button size="sm" variant="outline" @click="loadProfiles">
          {{ t("panel.common.retry") }}
        </Button>
      </Alert>

      <ul v-if="data.lists.length" class="divide-y rounded-lg border">
        <li v-for="list in data.lists" :key="list.id" class="grid gap-3 p-3">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="break-words font-semibold">
                {{ list.name }}
              </h3>
              <p class="break-words text-sm text-muted-foreground">
                {{ profilesById.get(list.profileId) }} ·
                {{ t(`${base}.every${list.intervalHours}`) }}
              </p>
            </div>
            <Badge
              :variant="
                listStatus(list) === 'error' ? 'destructive' : 'secondary'
              "
            >
              {{ t(`${base}.status.${listStatus(list)}`) }}
            </Badge>
          </div>

          <dl class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <div v-if="list.lastAttemptAt" class="flex flex-wrap gap-1">
              <dt class="text-muted-foreground">
                {{ t(`${base}.lastAttempt`) }}
              </dt>
              <dd>{{ runTime(list.lastAttemptAt) }}</dd>
            </div>
            <div v-if="list.lastReadAt" class="flex flex-wrap gap-1">
              <dt class="text-muted-foreground">
                {{ t(`${base}.lastRead`) }}
              </dt>
              <dd>{{ runTime(list.lastReadAt) }}</dd>
            </div>
            <div
              v-if="list.nextRunAt && !list.paused && !data.keyRejected"
              class="flex flex-wrap gap-1"
            >
              <dt class="text-muted-foreground">
                {{ t(`${base}.nextRun`) }}
              </dt>
              <dd>{{ runTime(list.nextRunAt) }}</dd>
            </div>
          </dl>

          <p v-if="list.lastResult?.error" class="text-sm text-destructive">
            {{ t(externalListErrorKey(list.lastResult.error)) }}
          </p>
          <template v-else-if="list.lastResult?.counts">
            <p class="text-sm text-muted-foreground">
              {{ t(`${base}.counts.found`) }}
              {{ list.lastResult.counts.found }} ·
              {{ t("home.rows.watchlist") }} +{{ list.lastResult.counts.added }}
            </p>
            <dl
              v-if="list.lastResult.status === 'partial'"
              class="flex flex-wrap gap-x-4 gap-y-1 text-xs"
            >
              <div v-if="list.lastResult.counts.pending" class="flex gap-1">
                <dt class="text-muted-foreground">
                  {{ t(`${base}.counts.pending`) }}
                </dt>
                <dd>{{ list.lastResult.counts.pending }}</dd>
              </div>
              <div v-if="list.lastResult.counts.deferred" class="flex gap-1">
                <dt class="text-muted-foreground">
                  {{ t(`${base}.counts.deferred`) }}
                </dt>
                <dd>{{ list.lastResult.counts.deferred }}</dd>
              </div>
            </dl>
          </template>
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              :disabled="
                temporarilyBusy
                  || list.running
                  || list.paused
                  || !data.hasKey
                  || data.keyRejected
              "
              @click="run(list)"
            >
              {{ t(`${base}.run`) }}
            </Button>
            <Button
              size="sm"
              variant="outline"
              :disabled="
                temporarilyBusy
                  || (list.paused && (!data.hasKey || data.keyRejected))
              "
              @click="togglePause(list)"
            >
              {{ t(`${base}.${list.paused ? "resume" : "pause"}`) }}
            </Button>
            <Button
              size="sm"
              variant="outline"
              :disabled="
                temporarilyBusy
                  || !data.hasKey
                  || data.keyRejected
                  || !profiles.length
              "
              @click="edit(list)"
            >
              {{ t(`${base}.edit`) }}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              :disabled="temporarilyBusy"
              @click="removal = list"
            >
              {{ t("panel.common.delete") }}
            </Button>
          </div>
        </li>
      </ul>
      <p v-else class="text-sm text-muted-foreground">
        {{ t(`${base}.empty`) }}
      </p>

      <ExternalListDialog
        v-model:open="editOpen"
        :list="editTarget"
        :profiles="profiles"
        @saved="load()"
      />
      <ExternalListExclusionsDialog
        v-model:open="exclusionsOpen"
        :profiles="profiles"
      />
      <AlertDialog v-model:open="removalOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{ removal === "key" ? t(`${base}.removeKey`) : removal?.name }}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {{
                t(
                  `${base}.${removal === "key" ? "removeKeyText" : "disconnect"}`,
                )
              }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {{
                t("panel.common.cancel")
              }}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" @click="remove">
              {{ t("panel.common.delete") }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </template>

    <template #hint>
      <a
        href="https://mdblist.com/preferences/"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
      >
        {{ t(`${base}.getKey`) }}
        <ExternalLinkIcon class="size-3.5" aria-hidden="true" />
      </a>
    </template>
    <template v-if="data" #action>
      <div class="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="!profiles.length"
          @click="exclusionsOpen = true"
        >
          {{ t(`${base}.exclusions`) }}
        </Button>
        <Button
          size="sm"
          :disabled="
            temporarilyBusy
              || !data.hasKey
              || data.keyRejected
              || !profiles.length
          "
          @click="edit(null)"
        >
          {{ t(`${base}.connect`) }}
        </Button>
      </div>
    </template>
  </SettingsCard>
</template>
