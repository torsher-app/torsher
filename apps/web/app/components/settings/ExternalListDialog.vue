<script setup lang="ts">
import type { Profile } from '@torsher/api-client'
import type {
  ExternalList,
  ExternalListInput,
  ExternalListPreviewResponse,
} from '~/lib/externalLists'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  externalListsKey as base,
  externalListErrorKey,
  externalListIntervals,
  externalListMedia,
  externalListRequestError,
} from '~/lib/externalLists'
import { api } from '~/services/api'
import ExternalListPreview from './ExternalListPreview.vue'

const props = defineProps<{
  list: ExternalList | null
  profiles: Profile[]
}>()
const emit = defineEmits<{ saved: [list: ExternalList] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const dialogId = useId()
const { defineField, handleSubmit, resetForm, isSubmitting }
  = useForm<ExternalListInput>()
const [source, sourceAttrs] = defineField('source')
const [profileId] = defineField('profileId')
const [media] = defineField('media')
const [interval] = defineField('intervalHours')
const preview = shallowRef<ExternalListPreviewResponse>()
const problem = ref<string>()
const confirming = ref(false)
const formReady = computed(() => !!source.value?.trim() && !!profileId.value)
const selectedProfile = computed(() =>
  props.profiles.find(profile => profile.id === profileId.value),
)
let revision = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollController: AbortController | undefined

function resetPreview() {
  revision++
  clearTimeout(pollTimer)
  pollController?.abort()
  pollController = undefined
  preview.value = undefined
  problem.value = undefined
}

watch(open, (value) => {
  resetPreview()
  if (value) {
    resetForm({
      values: {
        source: props.list?.sourceId.toString() ?? '',
        profileId: props.list?.profileId ?? '',
        media: props.list?.media ?? 'all',
        intervalHours: props.list?.intervalHours ?? 24,
      },
    })
  }
})

watch([source, profileId, media, interval], resetPreview, { flush: 'sync' })
onBeforeUnmount(resetPreview)

function applyPreview(result: ExternalListPreviewResponse, current: number) {
  if (current !== revision || !open.value)
    return

  preview.value = result
  if (result.status === 'error') {
    problem.value = externalListErrorKey(result.error)
  }
  else if (result.status === 'pending') {
    pollTimer = setTimeout(() => void pollPreview(result.token, current), 1000)
  }
}

async function pollPreview(token: string, current: number) {
  const controller = new AbortController()
  pollController = controller

  try {
    const result = await withErrorMode('silent', () =>
      api.settings.getExternalListPreview(token, { signal: controller.signal }))
    applyPreview(result, current)
  }
  catch (error) {
    if (current === revision) {
      preview.value = undefined
      problem.value = await externalListRequestError(error)
    }
  }
  finally {
    if (pollController === controller)
      pollController = undefined
  }
}

const startPreview = handleSubmit(async (values) => {
  if (
    !formReady.value
    || confirming.value
    || preview.value?.status === 'pending'
    || preview.value?.status === 'ready'
  ) {
    return
  }

  resetPreview()
  const current = revision

  try {
    const next = await withErrorMode('silent', () =>
      api.settings.startExternalListPreview({
        ...values,
        source: values.source.trim(),
        listId: props.list?.id,
      }))
    applyPreview(next, current)
  }
  catch (error) {
    if (current === revision)
      problem.value = await externalListRequestError(error)
  }
})

async function confirm() {
  const current = preview.value
  if (current?.status !== 'ready' || confirming.value)
    return

  confirming.value = true
  problem.value = undefined

  try {
    const list = await withErrorMode('silent', () =>
      api.settings.confirmExternalList({ token: current.token }))
    emit('saved', list)
    open.value = false
  }
  catch (error) {
    preview.value = undefined
    problem.value = await externalListRequestError(error)
  }
  finally {
    confirming.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      :show-close-button="false"
      @escape-key-down="confirming && $event.preventDefault()"
      @interact-outside="confirming && $event.preventDefault()"
    >
      <DialogHeader>
        <DialogTitle>
          {{
            t(`${base}.${list ? "edit" : "connect"}`)
          }}
        </DialogTitle>
        <DialogDescription>{{ t(`${base}.description`) }}</DialogDescription>
      </DialogHeader>

      <form class="grid gap-4" novalidate @submit="startPreview">
        <div class="grid gap-2">
          <Label :for="`${dialogId}-source`">{{ t(`${base}.source`) }}</Label>
          <Input
            :id="`${dialogId}-source`"
            v-model="source"
            v-bind="sourceAttrs"
            autocomplete="off"
            :disabled="confirming"
            :maxlength="512"
          />
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="grid min-w-0 gap-2">
            <Label :for="`${dialogId}-profile`">{{
              t(`${base}.profile`)
            }}</Label>
            <Select v-model="profileId" :disabled="confirming">
              <SelectTrigger :id="`${dialogId}-profile`" class="w-full">
                <SelectValue :placeholder="t(`${base}.profile`)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="profile in profiles"
                  :key="profile.id"
                  :value="profile.id"
                >
                  {{ profile.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid min-w-0 gap-2">
            <Label :for="`${dialogId}-media`">{{ t(`${base}.media`) }}</Label>
            <Select v-model="media" :disabled="confirming">
              <SelectTrigger :id="`${dialogId}-media`" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="kind in externalListMedia"
                  :key="kind"
                  :value="kind"
                >
                  {{
                    t(
                      kind === "all"
                        ? "home.all"
                        : kind === "movie"
                          ? "home.rows.libraryMovies"
                          : "home.rows.librarySeries",
                    )
                  }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid min-w-0 gap-2">
            <Label :for="`${dialogId}-interval`">{{
              t(`${base}.interval`)
            }}</Label>
            <Select v-model="interval" :disabled="confirming">
              <SelectTrigger :id="`${dialogId}-interval`" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="hours in externalListIntervals"
                  :key="hours"
                  :value="hours"
                >
                  {{ t(`${base}.every${hours}`) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Alert v-if="problem" variant="destructive" role="alert">
          <AlertDescription>{{ t(problem) }}</AlertDescription>
        </Alert>
        <p
          v-if="preview?.status === 'pending'"
          class="text-muted-foreground"
          role="status"
        >
          {{ t(`${base}.checking`) }}
        </p>
        <ExternalListPreview
          v-if="preview?.status === 'ready' && preview.preview"
          :preview="preview.preview"
          :profile-name="selectedProfile?.name ?? ''"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="confirming"
            @click="open = false"
          >
            {{ t("panel.common.cancel") }}
          </Button>
          <LoadingButton
            v-if="preview?.status === 'ready'"
            type="button"
            :loading="confirming"
            @click="confirm"
          >
            {{ t(`${base}.enable`) }}
          </LoadingButton>
          <LoadingButton
            v-else
            type="submit"
            :loading="isSubmitting || preview?.status === 'pending'"
            :disabled="!formReady"
          >
            {{ t(`${base}.preview`) }}
          </LoadingButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
