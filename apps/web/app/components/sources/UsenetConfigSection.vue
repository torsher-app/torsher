<script setup lang="ts">
import type { UsenetCheck, UsenetConfig } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import ListGroup from '~/components/ListGroup.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { httpUrlSchema } from '~/lib/sourceForms'
import { api } from '~/services/api'

const { t } = useI18n()
const supported = useState<boolean>('usenet-supported', () => false)
const saved = shallowRef<UsenetConfig | null>(null)
const checked = shallowRef<UsenetCheck>()
const shown = ref(false)
const loading = ref(false)
const checking = ref(false)
const problem = ref(false)
const approved = ref<string[]>()
let revision = 0

const fieldError = () => t('usenet.checkFailed')
const schema = toTypedSchema(
  z.object({
    url: httpUrlSchema(t('panel.sources.validation.url')),
    apiKey: z.string().trim().max(500, fieldError()),
    category: z.string().trim().min(1, fieldError()).max(64, fieldError()),
    remoteRoot: z.string().trim().min(1, fieldError()).max(4096, fieldError()),
    localRoot: z.string().trim().min(1, fieldError()).max(4096, fieldError()),
    enabled: z.boolean(),
    followEnabled: z.boolean(),
  }),
)
const defaults = {
  url: '',
  apiKey: '',
  category: '',
  remoteRoot: '',
  localRoot: '',
  enabled: false,
  followEnabled: false,
}
const { defineField, errors, handleSubmit, resetForm, isSubmitting } = useForm({
  validationSchema: schema,
  initialValues: defaults,
})
const [url, urlAttrs] = defineField('url')
const [apiKey, apiKeyAttrs] = defineField('apiKey')
const [category, categoryAttrs] = defineField('category')
const [remoteRoot, remoteRootAttrs] = defineField('remoteRoot')
const [localRoot, localRootAttrs] = defineField('localRoot')
const [enabled] = defineField('enabled')
const [followEnabled] = defineField('followEnabled')
const busy = computed(() => checking.value || isSubmitting.value)
const origin = computed(() => {
  try {
    return new URL(url.value ?? '').origin
  }
  catch {
    return ''
  }
})
const confirmation = computed(
  () =>
    checked.value?.connection === 'needs_confirmation'
    || checked.value?.connection === 'address_changed',
)

watch([url, apiKey, category, remoteRoot, localRoot], () => {
  checked.value = undefined
  problem.value = false
  revision++
  checking.value = false
})
watch(origin, () => {
  approved.value = undefined
})

function reset(config: UsenetConfig | null) {
  saved.value = config
  resetForm({ values: config ? { ...config, apiKey: '' } : defaults })
  approved.value = undefined
  checked.value = undefined
  problem.value = false
}

async function load() {
  loading.value = true
  try {
    const { config } = await withErrorMode('silent', () =>
      api.usenet.getUsenetConfig())
    reset(config)
    supported.value = true
  }
  catch {
    supported.value = false
  }
  finally {
    loading.value = false
  }
}

const check = handleSubmit(async (values) => {
  if (checking.value)
    return
  const current = ++revision
  checking.value = true
  problem.value = false
  checked.value = undefined
  try {
    const result = await withErrorMode('silent', () =>
      api.usenet.postUsenetCheck({
        ...values,
        apiKey: values.apiKey || undefined,
        lanAddresses: approved.value,
      }))
    if (current === revision)
      checked.value = result
  }
  catch {
    if (current === revision)
      problem.value = true
  }
  finally {
    if (current === revision)
      checking.value = false
  }
})

function confirmAddress() {
  approved.value = checked.value?.lanAddresses
  void check()
}

const save = handleSubmit(async (values) => {
  problem.value = false
  try {
    const next = await withErrorMode('silent', () =>
      api.usenet.putUsenetConfig({
        ...values,
        apiKey: values.apiKey || undefined,
        followEnabled: values.enabled && values.followEnabled,
        lanAddresses: approved.value,
      }))
    reset(next)
    shown.value = false
  }
  catch {
    problem.value = true
  }
})

onMounted(load)
</script>

<template>
  <section
    v-if="supported && !loading"
    class="border-b"
    :aria-label="t('usenet.title')"
  >
    <ListGroup :title="t('usenet.title')">
      <template #meta>
        {{ saved?.url || t("usenet.sabnzbd") }}
        <span v-if="saved?.restoreBlocked">
          · {{ t("panel.torrents.groups.attention") }}</span>
      </template>
      <template #actions>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          :aria-expanded="shown"
          @click="shown = !shown"
        >
          {{ t(shown ? "panel.common.close" : "panel.nav.settings") }}
        </Button>
      </template>
    </ListGroup>
    <form v-if="shown" class="grid max-w-2xl gap-4 p-4" @submit.prevent="save">
      <div class="grid gap-2">
        <Label for="usenet-client-url">{{ t("usenet.url") }}</Label>
        <Input
          id="usenet-client-url"
          v-model="url"
          v-bind="urlAttrs"
          type="url"
          :disabled="busy"
          :aria-invalid="!!errors.url"
        />
        <p v-if="errors.url" class="text-xs text-destructive">
          {{ errors.url }}
        </p>
      </div>
      <div class="grid gap-2">
        <Label for="usenet-client-key">{{
          t("panel.sources.addDialog.apiKey")
        }}</Label>
        <SecretInput
          id="usenet-client-key"
          v-model="apiKey"
          v-bind="apiKeyAttrs"
          :disabled="busy"
          :placeholder="saved?.hasApiKey ? '••••••••' : undefined"
          :show-label="t('panel.common.showKey')"
          :hide-label="t('panel.common.hideKey')"
          autocomplete="off"
        />
        <p v-if="errors.apiKey" class="text-xs text-destructive">
          {{ errors.apiKey }}
        </p>
      </div>
      <div class="grid gap-2">
        <Label for="usenet-client-category">{{ t("usenet.category") }}</Label>
        <Input
          id="usenet-client-category"
          v-model="category"
          v-bind="categoryAttrs"
          :disabled="busy"
          :aria-invalid="!!errors.category"
        />
        <p v-if="errors.category" class="text-xs text-destructive">
          {{ errors.category }}
        </p>
      </div>
      <div class="grid gap-2">
        <Label for="usenet-client-remote">{{ t("usenet.remoteRoot") }}</Label>
        <Input
          id="usenet-client-remote"
          v-model="remoteRoot"
          v-bind="remoteRootAttrs"
          :disabled="busy"
          :aria-invalid="!!errors.remoteRoot"
        />
        <p v-if="errors.remoteRoot" class="text-xs text-destructive">
          {{ errors.remoteRoot }}
        </p>
      </div>
      <div class="grid gap-2">
        <Label for="usenet-client-local">{{ t("usenet.localRoot") }}</Label>
        <Input
          id="usenet-client-local"
          v-model="localRoot"
          v-bind="localRootAttrs"
          :disabled="busy"
          :aria-invalid="!!errors.localRoot || checked?.pathReadable === false"
        />
        <p v-if="errors.localRoot" class="text-xs text-destructive">
          {{ errors.localRoot }}
        </p>
      </div>
      <div class="flex items-center justify-between gap-3">
        <Label for="usenet-client-enabled">{{ t("usenet.title") }}</Label>
        <Switch id="usenet-client-enabled" v-model="enabled" :disabled="busy" />
      </div>
      <div class="flex items-center justify-between gap-3">
        <Label for="usenet-client-follow">{{ t("usenet.follow") }}</Label>
        <Switch
          id="usenet-client-follow"
          v-model="followEnabled"
          :disabled="busy || !enabled"
        />
      </div>
      <div v-if="confirmation" class="grid gap-2 rounded-md border p-3">
        <p class="font-mono text-xs break-all">
          {{ [origin, ...(checked?.lanAddresses ?? [])].join(" · ") }}
        </p>
        <Button
          type="button"
          size="sm"
          class="justify-self-start"
          :disabled="busy"
          @click="confirmAddress"
        >
          {{ t("usenet.confirmAddress") }}
        </Button>
      </div>
      <Alert
        v-if="
          problem || (checked && !confirmation && checked.connection !== 'ok')
        "
        variant="destructive"
      >
        <AlertDescription>{{ t("usenet.checkFailed") }}</AlertDescription>
      </Alert>
      <Alert v-if="saved?.restoreBlocked" variant="destructive">
        <AlertDescription>
          {{ t("panel.torrents.groups.attention") }}
          <a
            href="https://torsher.app/docs/setup/indexers#usenet-with-sabnzbd"
            class="underline"
          >
            {{ t("panel.nav.docs") }}
          </a>
        </AlertDescription>
      </Alert>
      <p v-if="confirmation && !apiKey" class="text-xs text-muted-foreground">
        {{ t("panel.sources.validation.apiKey") }}
      </p>
      <Alert v-if="checked?.pathReadable === false" variant="destructive">
        <AlertDescription>{{ t("usenet.pathUnreadable") }}</AlertDescription>
      </Alert>
      <p
        v-if="checked?.connection === 'ok' && checked.pathReadable"
        role="status"
        class="text-sm text-muted-foreground"
      >
        {{ t("panel.sources.status.ok") }}
      </p>
      <div class="flex flex-wrap gap-2">
        <LoadingButton
          type="button"
          variant="outline"
          :loading="checking"
          :disabled="isSubmitting"
          @click="check"
        >
          {{ t("panel.settings.network.hosts.check") }}
        </LoadingButton>
        <LoadingButton
          type="submit"
          :loading="isSubmitting"
          :disabled="
            checking
              || confirmation
              || (!saved && !(checked?.connection === 'ok' && checked.pathReadable))
          "
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </div>
    </form>
  </section>
</template>
