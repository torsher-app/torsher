<script setup lang="ts">
import type { JellyfinImportError, Profile } from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { z } from 'zod'
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
import LoadingButton from '~/components/LoadingButton.vue'
import { IMPORT_POLL_MS } from '~/composables/useProfileImports'
import { dialogSheetClass } from '~/lib/dialog'
import { formatDateTime } from '~/lib/format'
import { api } from '~/services/api'

const { profile } = defineProps<{ profile: Profile }>()
const emit = defineEmits<{ applied: [] }>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()
const fieldId = useId()

const addressForm = useForm({
  validationSchema: computed(() => toTypedSchema(z.object({
    url: z.url({ protocol: /^https$/, error: t('panel.jellyfinImport.failed') }),
  }))),
  initialValues: { url: '' },
})
const [address] = addressForm.defineField('url')
const credentialsForm = useForm({
  validationSchema: computed(() => toTypedSchema(z.object({
    username: z.string().trim().min(1, t('panel.jellyfinImport.failed')),
    password: z.string(),
  }))),
  initialValues: { username: '', password: '' },
})
const [username] = credentialsForm.defineField('username')
const [password] = credentialsForm.defineField('password')

const connection = shallowRef<Awaited<ReturnType<typeof api.profiles.postProfileJellyfinConnection>>>()
const preview = shallowRef<Awaited<ReturnType<typeof api.profiles.getProfileJellyfinPreview>>>()
const pending = ref<string>()
const error = ref<'failed' | 'stale'>()
const applying = ref(false)
const skipLabels = {
  invalid: 'panel.follow.arrImport.reason.invalid',
  unmatched: 'panel.follow.arrImport.reason.unmatched',
  restricted: 'panel.people.profiles.ageLimit',
  duplicate: 'panel.follow.arrImport.reason.duplicate',
} as const

let requestVersion = 0
let timer: ReturnType<typeof setTimeout> | undefined

function cancelJob(profileId: string, id: string) {
  return withErrorMode('silent', () => api.profiles.deleteProfileJellyfinPreview(profileId, id))
    .catch(() => undefined)
}

function reset() {
  requestVersion++
  clearTimeout(timer)
  if (pending.value)
    void cancelJob(profile.id, pending.value)
  pending.value = undefined
  preview.value = undefined
  connection.value = undefined
  error.value = undefined
  credentialsForm.resetForm()
}

watch(open, (value) => {
  if (!value) {
    reset()
    addressForm.resetForm()
  }
})
onBeforeUnmount(reset)

function hasSecurePanel() {
  if (window.location.protocol === 'https:')
    return true
  error.value = 'failed'
  return false
}

const checkAddress = addressForm.handleSubmit(async ({ url }) => {
  reset()
  if (!hasSecurePanel())
    return
  const version = requestVersion
  try {
    const result = await withErrorMode('silent', () => api.profiles.postProfileJellyfinConnection(profile.id, { url }))
    if (version === requestVersion)
      connection.value = result
  }
  catch {
    if (version === requestVersion)
      error.value = 'failed'
  }
})

function poll(profileId: string, id: string, version: number) {
  timer = setTimeout(async () => {
    try {
      const result = await withErrorMode('silent', () => api.profiles.getProfileJellyfinPreview(profileId, id))
      if (version !== requestVersion)
        return
      preview.value = result
      if (result.state === 'failed')
        error.value = 'failed'
      else if (result.state !== 'ready')
        poll(profileId, id, version)
    }
    catch {
      if (version === requestVersion)
        error.value = 'failed'
    }
  }, IMPORT_POLL_MS)
}

const startPreview = credentialsForm.handleSubmit(async (credentials) => {
  const checked = connection.value
  if (!checked || !hasSecurePanel())
    return
  error.value = undefined
  const version = requestVersion
  const profileId = profile.id
  try {
    const job = await withErrorMode('silent', () => api.profiles.postProfileJellyfinPreview(profileId, {
      connectionId: checked.id,
      ...credentials,
    }))
    if (version !== requestVersion) {
      void cancelJob(profileId, job.id)
      return
    }
    pending.value = job.id
    poll(profileId, job.id, version)
  }
  catch {
    if (version === requestVersion)
      error.value = 'failed'
  }
  finally {
    if (version === requestVersion)
      credentialsForm.resetForm()
  }
})

async function apply() {
  const job = pending.value
  if (applying.value || !job)
    return
  applying.value = true
  error.value = undefined
  try {
    await withErrorMode('silent', () => api.profiles.postProfileJellyfinApply(profile.id, job))
    pending.value = undefined
    open.value = false
    emit('applied')
    toast.success(t('panel.imports.dialog.done'))
  }
  catch (failure) {
    if (getErrorStatus(failure) === 409
      && (await getErrorBody<JellyfinImportError>(failure))?.kind === 'profileChanged') {
      reset()
      error.value = 'stale'
    }
    else {
      error.value = 'failed'
    }
  }
  finally {
    applying.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass" :show-close-button="!applying" @escape-key-down="applying && $event.preventDefault()" @interact-outside="applying && $event.preventDefault()">
      <DialogHeader>
        <DialogTitle>{{ t('panel.jellyfinImport.title') }}</DialogTitle>
        <DialogDescription>{{ t('panel.jellyfinImport.description', { profile: profile.name }) }}</DialogDescription>
      </DialogHeader>

      <Alert v-if="error" variant="destructive" role="alert">
        <AlertDescription>{{ t(`panel.jellyfinImport.${error}`) }}</AlertDescription>
      </Alert>
      <Alert v-if="preview?.logoutWarning" role="status">
        <AlertDescription>{{ t('panel.jellyfinImport.logoutWarning') }}</AlertDescription>
      </Alert>

      <form v-if="!connection" class="grid gap-3" @submit.prevent="checkAddress">
        <Label :for="`${fieldId}-address`">{{ t('panel.jellyfinImport.address') }}</Label>
        <Input :id="`${fieldId}-address`" v-model="address" type="url" autocomplete="off" maxlength="2048" required />
        <p v-if="addressForm.errors.value.url" role="alert" class="text-sm text-destructive">
          {{ addressForm.errors.value.url }}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">
            {{ t('panel.common.cancel') }}
          </Button>
          <LoadingButton type="submit" :loading="addressForm.isSubmitting.value">
            {{ t('panel.jellyfinImport.checkAddress') }}
          </LoadingButton>
        </DialogFooter>
      </form>

      <div v-else-if="preview?.state === 'ready'" class="grid gap-3">
        <div class="grid gap-1 break-words text-sm">
          <p v-if="preview.source">
            {{ t('panel.jellyfinImport.source', { server: preview.source.server, user: preview.source.user }) }}
          </p>
          <p>{{ t('panel.jellyfinImport.target', { profile: profile.name }) }}</p>
          <p v-if="preview.lastActivityAt" class="text-muted-foreground">
            {{ t('panel.jellyfinImport.lastActivity', { time: formatDateTime(preview.lastActivityAt, locale) }) }}
          </p>
          <template v-for="kind in ['movies', 'episodes'] as const" :key="kind">
            <h4 class="pt-1 font-medium">
              {{ t(`mine.preview.diary.filters.${kind}`) }}
            </h4>
            <ul v-if="preview[kind]" class="text-muted-foreground">
              <li>{{ t('panel.jellyfinImport.added', { added: preview[kind]?.added }) }}</li>
              <li>{{ t('panel.jellyfinImport.existing', { existing: preview[kind]?.existing }) }}</li>
              <li>{{ t('panel.jellyfinImport.skipped', { skipped: preview[kind]?.skipped }) }}</li>
            </ul>
          </template>
          <ul v-if="preview.skipped" class="pt-1 text-muted-foreground">
            <template v-for="(count, reason) in preview.skipped" :key="reason">
              <li v-if="count">
                {{ t(skipLabels[reason]) }} · {{ count }}
              </li>
            </template>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="applying" @click="open = false">
            {{ t('panel.common.cancel') }}
          </Button>
          <LoadingButton :loading="applying" @click="apply">
            {{ t('panel.imports.dialog.apply') }}
          </LoadingButton>
        </DialogFooter>
      </div>

      <div v-else-if="pending" class="grid gap-3">
        <p v-if="!error" class="text-sm text-muted-foreground" role="status">
          {{ t('panel.jellyfinImport.reading') }}
        </p>
        <DialogFooter>
          <Button variant="outline" @click="open = false">
            {{ t('panel.common.cancel') }}
          </Button>
          <Button v-if="error" @click="reset">
            {{ t('panel.common.retry') }}
          </Button>
        </DialogFooter>
      </div>

      <form v-else class="grid gap-3" autocomplete="off" @submit.prevent="startPreview">
        <p class="break-all text-sm text-muted-foreground">
          {{ t('panel.jellyfinImport.destination', { address: connection.address, addresses: connection.addresses.join(', ') }) }}
        </p>
        <div class="grid gap-2">
          <Label :for="`${fieldId}-user`">{{ t('panel.jellyfinImport.username') }}</Label>
          <Input :id="`${fieldId}-user`" v-model="username" type="text" autocomplete="off" maxlength="256" required />
        </div>
        <div class="grid gap-2">
          <Label :for="`${fieldId}-password`">{{ t('panel.jellyfinImport.password') }}</Label>
          <Input :id="`${fieldId}-password`" v-model="password" type="password" autocomplete="off" maxlength="1024" />
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" @click="open = false">
            {{ t('panel.common.cancel') }}
          </Button>
          <LoadingButton type="submit" :loading="credentialsForm.isSubmitting.value">
            {{ t('panel.jellyfinImport.preview') }}
          </LoadingButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
