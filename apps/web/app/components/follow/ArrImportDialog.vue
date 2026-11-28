<script setup lang="ts">
import { getErrorBody } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { dialogSheetClass } from '~/lib/dialog'
import { httpUrlSchema } from '~/lib/sourceForms'
import { api } from '~/services/api'

const emit = defineEmits<{ applied: [] }>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()
const base = 'panel.follow.arrImport'
const { profiles, state: profilesState, load: loadProfiles } = useProfiles()
const eligibleProfiles = computed(() =>
  profiles.value.filter(profile => profile.ageLimit === null),
)

const { defineField, errors, handleSubmit, resetForm, setFieldValue } = useForm(
  {
    validationSchema: toTypedSchema(
      z.object({
        kind: z.enum(['sonarr', 'radarr']),
        url: httpUrlSchema(t('panel.sources.validation.url')),
        profileId: z.string().min(1, t('panel.follow.arrImport.error.profile')),
        apiKey: z.string().max(512, t('panel.sources.validation.apiKey')),
      }),
    ),
    initialValues: { kind: 'sonarr', url: '', profileId: '', apiKey: '' },
  },
)

const [kind] = defineField('kind')
const [url, urlProps] = defineField('url')
const [profileId] = defineField('profileId')
const [apiKey, apiKeyProps] = defineField('apiKey')

type Connection = Awaited<ReturnType<typeof api.transfer.postArrConnection>>
type Preview = Awaited<ReturnType<typeof api.transfer.getArrPreview>>
type Result = Awaited<ReturnType<typeof api.transfer.postArrApply>>
type PreviewRow = Preview['rows'][number]

const connection = shallowRef<Connection>()
const approved = ref(false)
const previewId = ref<string>()
const preview = shallowRef<Preview>()
const result = shallowRef<Result>()
const selected = ref<string[]>([])
const submitted = shallowRef<string[]>()
const busy = ref<'checking' | 'starting' | 'applying'>()
const errorKind = ref<string>()
const previewFailed = ref(false)
const dialogId = useId()

let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined

const profileName = computed(
  () =>
    eligibleProfiles.value.find(profile => profile.id === profileId.value)
      ?.name,
)
const selectedLabel = computed(() =>
  t('panel.follow.arrImport.selected', {
    count: selected.value.length,
    profile: profileName.value ?? '',
  }),
)
const description = computed(() => {
  const counts = result.value
  if (counts) {
    return t('panel.follow.arrImport.result', {
      created: counts.created,
      skipped: counts.skipped,
      failed: counts.failed,
    })
  }

  return t(
    previewId.value
      ? 'panel.follow.arrImport.pausedHint'
      : 'panel.follow.arrImport.addressHint',
  )
})
const selectedIds = computed(() => new Set(selected.value))
const readyForKey = computed(
  () =>
    connection.value
    && (connection.value.addresses.length === 0 || approved.value),
)
const loadingPreview = computed(
  () =>
    !!previewId.value
    && !preview.value?.rows.length
    && preview.value?.state !== 'ready'
    && !errorKind.value,
)
const resultById = computed(
  () => new Map(result.value?.rows.map(row => [row.id, row])),
)
const rows = computed(() =>
  result.value
    ? preview.value?.rows.filter(row => resultById.value.has(row.id))
    : preview.value?.rows,
)

const sourceStatusText = {
  upcoming: 'mine.schedule.upcoming',
  continuing: 'title.statuses.returning',
  ended: 'title.statuses.ended',
  deleted: 'panel.follow.arrImport.reason.deleted',
} as const

function rowNotes(row: PreviewRow) {
  const notes = row.reasons.map(reason => t(`${base}.reason.${reason}`))
  const status = row.sourceStatus
  if (
    status
    && !(
      (status === 'ended' || status === 'deleted')
      && row.reasons.includes(status)
    )
  ) {
    notes.unshift(t(sourceStatusText[status]))
  }

  return notes.join(' · ')
}

const errorKeys = new Set([
  'address',
  'address_changed',
  'auth',
  'unsupported',
  'bad_response',
  'limit',
  'expired',
  'profile',
  'busy',
  'request',
])

async function readError(error: unknown) {
  const body = await getErrorBody<{ kind?: string }>(error)
  const kind = body?.kind

  return kind && errorKeys.has(kind) ? kind : 'request'
}

function discard(id = previewId.value) {
  if (id) {
    void withErrorMode('silent', () => api.transfer.deleteArrPreview(id)).catch(
      () => {},
    )
  }
}

function reset() {
  revision++
  clearTimeout(timer)
  discard()
  previewId.value = undefined
  connection.value = undefined
  approved.value = false
  preview.value = undefined
  result.value = undefined
  submitted.value = undefined
  selected.value = []
  errorKind.value = undefined
  previewFailed.value = false
  busy.value = undefined
  setFieldValue('apiKey', '', false)
}

watch(open, (value) => {
  reset()
  resetForm()

  if (value)
    void loadProfiles()
})
onBeforeUnmount(reset)

watch([kind, url], () => {
  connection.value = undefined
  approved.value = false
  setFieldValue('apiKey', '', false)
})

function changeOpen(value: boolean) {
  if (busy.value !== 'applying')
    open.value = value
}

function setSelected(id: string, checked: boolean | 'indeterminate') {
  selected.value
    = checked === true
      ? [...selected.value, id]
      : selected.value.filter(item => item !== id)
}

function selectAll() {
  selected.value
    = preview.value?.rows.filter(row => row.selectable).map(row => row.id)
      ?? []
}

async function loadPreview(id: string, current: number) {
  errorKind.value = undefined
  try {
    const snapshot = await withErrorMode('silent', () =>
      api.transfer.getArrPreview(id))

    if (current !== revision)
      return

    preview.value = snapshot
    if (snapshot.state === 'ready') {
      selected.value = snapshot.rows
        .filter(row => row.selected)
        .map(row => row.id)
      return
    }

    timer = setTimeout(() => {
      void loadPreview(id, current)
    }, 650)
  }
  catch (error) {
    const problem = await getErrorBody<{ kind?: string }>(error)
    if (current === revision) {
      const kind = problem?.kind
      previewFailed.value = kind !== undefined && errorKeys.has(kind)
      errorKind.value = previewFailed.value ? kind : 'request'
    }
  }
}

async function checkAddress(values: {
  kind: 'sonarr' | 'radarr'
  url: string
}) {
  const current = revision
  busy.value = 'checking'
  errorKind.value = undefined

  try {
    const checked = await withErrorMode('silent', () =>
      api.transfer.postArrConnection(values))
    if (current === revision)
      connection.value = checked
  }
  catch (error) {
    const problem = await readError(error)
    if (current === revision)
      errorKind.value = problem
  }
  finally {
    if (current === revision)
      busy.value = undefined
  }
}

const onSubmit = handleSubmit(async (values) => {
  if (busy.value)
    return
  if (!connection.value) {
    await checkAddress({ kind: values.kind, url: values.url })
    return
  }
  if (!readyForKey.value || !values.apiKey.trim())
    return

  const current = revision
  const connectionId = connection.value.id
  const language
    = locale.value.replace('_', '-') === 'ru-RU' ? 'ru-RU' : 'en-US'
  busy.value = 'starting'
  errorKind.value = undefined

  try {
    const request = withErrorMode('silent', () =>
      api.transfer.postArrPreview({
        connectionId,
        approveLan: approved.value,
        apiKey: values.apiKey.trim(),
        profileId: values.profileId,
        language,
      }))
    setFieldValue('apiKey', '', false)
    const job = await request

    if (current !== revision) {
      discard(job.id)
      return
    }

    previewId.value = job.id
    void loadPreview(job.id, current)
  }
  catch (error) {
    const problem = await readError(error)
    if (current === revision) {
      connection.value = undefined
      approved.value = false
      errorKind.value = problem
    }
  }
  finally {
    if (current === revision)
      busy.value = undefined
  }
})

async function apply() {
  if (!previewId.value || !selected.value.length || busy.value)
    return

  const current = revision
  submitted.value ??= [...selected.value]
  busy.value = 'applying'
  errorKind.value = undefined

  try {
    const response = await withErrorMode('silent', () =>
      api.transfer.postArrApply({
        previewId: previewId.value!,
        rowIds: submitted.value!,
      }))
    if (current === revision)
      result.value = response

    emit('applied')
  }
  catch (error) {
    const problem = await readError(error)
    if (current === revision)
      errorKind.value = problem
  }
  finally {
    if (current === revision)
      busy.value = undefined
  }
}

function retry() {
  if (errorKind.value === 'request' || errorKind.value === 'busy') {
    if (submitted.value) {
      void apply()
      return
    }
    if (previewId.value && !previewFailed.value) {
      void loadPreview(previewId.value, revision)
      return
    }
  }

  reset()
}
</script>

<template>
  <Dialog :open="open" @update:open="changeOpen">
    <DialogTrigger as-child>
      <slot />
    </DialogTrigger>
    <DialogContent
      class="sm:max-w-xl"
      :class="[dialogSheetClass]"
      :show-close-button="busy !== 'applying'"
      @escape-key-down="busy === 'applying' && $event.preventDefault()"
      @interact-outside="busy === 'applying' && $event.preventDefault()"
    >
      <DialogHeader>
        <DialogTitle>{{ t(`${base}.title`) }}</DialogTitle>
        <DialogDescription>
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <form
        v-if="!previewId"
        :id="`${dialogId}-form`"
        class="grid gap-4"
        novalidate
        @submit.prevent="onSubmit"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label :for="`${dialogId}-kind`">{{ t(`${base}.source`) }}</Label>
            <Select v-model="kind" :disabled="!!busy">
              <SelectTrigger :id="`${dialogId}-kind`" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sonarr">
                  Sonarr
                </SelectItem>
                <SelectItem value="radarr">
                  Radarr
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-2">
            <Label :for="`${dialogId}-profile`">{{
              t(`${base}.profile`)
            }}</Label>
            <Select
              v-model="profileId"
              :disabled="!!busy || !eligibleProfiles.length"
            >
              <SelectTrigger
                :id="`${dialogId}-profile`"
                class="w-full"
                :aria-invalid="!!errors.profileId"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="profile in eligibleProfiles"
                  :key="profile.id"
                  :value="profile.id"
                >
                  {{ profile.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p
              v-if="
                errors.profileId
                  || (profilesState === 'ready' && !eligibleProfiles.length)
              "
              class="text-sm text-destructive"
            >
              {{ errors.profileId || t(`${base}.error.profile`) }}
            </p>
            <Button
              v-if="profilesState === 'error'"
              variant="outline"
              type="button"
              @click="loadProfiles"
            >
              {{ t("panel.common.retry") }}
            </Button>
          </div>
        </div>

        <div class="grid gap-2">
          <Label :for="`${dialogId}-url`">{{
            t("panel.sources.importDialog.url")
          }}</Label>
          <Input
            :id="`${dialogId}-url`"
            v-model="url"
            v-bind="urlProps"
            type="url"
            :placeholder="
              kind === 'radarr' ? 'http://radarr:7878' : 'http://sonarr:8989'
            "
            :aria-invalid="!!errors.url"
            :aria-describedby="errors.url ? `${dialogId}-url-error` : undefined"
            :disabled="!!busy"
          />
          <p
            v-if="errors.url"
            :id="`${dialogId}-url-error`"
            class="text-sm text-destructive"
          >
            {{ errors.url }}
          </p>
        </div>

        <Alert v-if="connection?.addresses.length && !approved">
          <AlertDescription class="grid gap-3">
            <p class="break-all">
              {{
                t(`${base}.lanHint`, {
                  origin: connection.origin,
                  addresses: connection.addresses.join(", "),
                })
              }}
            </p>
            <Button
              class="justify-self-start"
              variant="outline"
              type="button"
              @click="approved = true"
            >
              {{ t(`${base}.allowConnection`) }}
            </Button>
          </AlertDescription>
        </Alert>

        <div v-if="readyForKey" class="grid gap-2">
          <Label :for="`${dialogId}-key`">{{
            t("panel.sources.importDialog.apiKey")
          }}</Label>
          <SecretInput
            :id="`${dialogId}-key`"
            v-model="apiKey"
            v-bind="apiKeyProps"
            autocomplete="off"
            :show-label="t('panel.common.showKey')"
            :hide-label="t('panel.common.hideKey')"
            :aria-invalid="!!errors.apiKey"
            :disabled="!!busy"
          />
          <p v-if="errors.apiKey" class="text-sm text-destructive">
            {{ errors.apiKey }}
          </p>
        </div>
      </form>

      <p
        v-else-if="loadingPreview"
        class="text-sm text-muted-foreground"
        role="status"
      >
        {{
          preview?.total
            ? t(`${base}.progress`, {
              checked: preview.checked,
              total: preview.total,
            })
            : t(`${base}.prepare`)
        }}
      </p>

      <template v-if="preview?.state === 'ready'">
        <div v-if="!result" class="grid gap-2">
          <p class="text-sm font-medium">
            {{ kind === "sonarr" ? "Sonarr" : "Radarr" }} ·
            {{ t(kind === "sonarr" ? "title.series" : "title.movie") }}
          </p>
          <p v-if="kind === 'sonarr'" class="text-sm text-muted-foreground">
            {{ t(`${base}.seriesHint`) }}
          </p>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p class="mr-auto text-sm font-medium" aria-live="polite">
              {{ selectedLabel }}
            </p>
            <Button
              v-if="preview.rows.some((row) => row.selectable)"
              size="sm"
              variant="ghost"
              :disabled="!!submitted"
              @click="selectAll"
            >
              {{ t(`${base}.selectAll`) }}
            </Button>
            <Button
              v-if="selected.length"
              size="sm"
              variant="ghost"
              :disabled="!!submitted"
              @click="selected = []"
            >
              {{ t(`${base}.clear`) }}
            </Button>
          </div>
        </div>
        <ul
          v-if="rows?.length"
          class="max-h-[42dvh] min-w-0 divide-y overflow-y-auto rounded-md border"
        >
          <li
            v-for="row in rows"
            :key="row.id"
            class="flex min-w-0 items-start gap-3 px-3 py-2.5"
          >
            <Checkbox
              v-if="row.selectable && !result"
              :id="`${dialogId}-row-${row.id}`"
              class="mt-0.5 shrink-0"
              :model-value="selectedIds.has(row.id)"
              :disabled="!!submitted"
              @update:model-value="setSelected(row.id, $event)"
            />
            <div class="min-w-0">
              <Label
                v-if="row.selectable && !result"
                :for="`${dialogId}-row-${row.id}`"
                class="block break-words"
              >
                {{ row.sourceTitle || row.title
                }}{{ row.year ? ` (${row.year})` : "" }}
              </Label>
              <p
                v-else-if="row.sourceTitle || row.title"
                class="text-sm font-medium break-words"
              >
                {{ row.sourceTitle || row.title
                }}{{ row.year ? ` (${row.year})` : "" }}
              </p>
              <p
                v-if="
                  row.title && row.sourceTitle && row.title !== row.sourceTitle
                "
                class="text-sm break-words"
              >
                {{ row.title }}
              </p>
              <p v-if="result" class="text-xs text-muted-foreground">
                {{ t(`${base}.reason.${resultById.get(row.id)?.reason}`) }}
              </p>
              <p
                v-else-if="row.sourceStatus || row.reasons.length"
                class="text-xs text-muted-foreground"
              >
                {{ rowNotes(row) }}
              </p>
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">
          {{ t(`${base}.empty`) }}
        </p>
      </template>

      <Alert v-if="errorKind" variant="destructive">
        <AlertDescription>
          {{
            t(`${base}.error.${errorKind}`)
          }}
        </AlertDescription>
      </Alert>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          :disabled="busy === 'applying'"
          @click="changeOpen(false)"
        >
          {{ t(result ? "panel.common.close" : "panel.common.cancel") }}
        </Button>
        <Button v-if="errorKind && previewId" type="button" @click="retry">
          {{ t("panel.common.retry") }}
        </Button>
        <LoadingButton
          v-else-if="!previewId"
          :form="`${dialogId}-form`"
          type="submit"
          :disabled="
            !eligibleProfiles.length
              || (!!connection && (!readyForKey || !apiKey?.trim()))
          "
          :loading="busy === 'checking' || busy === 'starting'"
        >
          {{ t(connection ? `${base}.prepare` : `${base}.checkAddress`) }}
        </LoadingButton>
        <LoadingButton
          v-else-if="preview?.state === 'ready' && !result"
          type="button"
          :loading="busy === 'applying'"
          :disabled="!selected.length"
          @click="apply"
        >
          {{ t("panel.sources.importDialog.submit") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
