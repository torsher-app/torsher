<script setup lang="ts">
import type {
  SubtitleProviderStatus,
  SubtitleSettings,
  UpdateSubtitleSettingsInput,
} from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import { api } from '~/services/api'
import SettingsCard from './SettingsCard.vue'

type Language = SubtitleSettings['languages'][number]

const props = defineProps<{
  kind: 'opensubtitles' | 'subdl'
  settings: SubtitleSettings
}>()
const emit = defineEmits<{ saved: [settings: SubtitleSettings] }>()
const { t, locale } = useI18n()
const open = computed(() => props.kind === 'opensubtitles')
const provider = computed(() =>
  open.value ? props.settings.openSubtitles : props.settings.subdl,
)
const checking = ref(false)
const disconnecting = ref(false)
const result = shallowRef<SubtitleProviderStatus>()
const message = ref<'auth' | 'unavailable'>()
const connection = computed(() => result.value ?? provider.value.connection)
const providerName = computed(() =>
  open.value ? 'OpenSubtitles.com' : 'SubDL',
)
const base = 'panel.settings.playback.subtitles'
const connectionLabel = computed(() => {
  const status = connection.value
  if (status?.kind === 'quota') {
    return status.remainingDownloads === 0
      ? t('player.subtitleSearch.quota')
      : t(`${base}.unavailable`)
  }
  return status
    ? t(`${base}.${status.kind}`)
    : provider.value.configured
      ? ''
      : t(`${base}.disconnected`)
})

function defaults(settings: SubtitleSettings) {
  return {
    apiKey: '',
    username: '',
    password: '',
    deviceSearch: settings.openSubtitles.deviceSearch,
    autoDownload: settings.openSubtitles.autoDownload,
    languages: settings.openSubtitles.languages,
  }
}

const schema = toTypedSchema(
  z.object({
    apiKey: z.string().trim().max(1024),
    username: z.string().trim().max(1024),
    password: z.string().max(1024),
    deviceSearch: z.boolean(),
    autoDownload: z.boolean(),
    languages: z.array(z.string()).max(12),
  }),
)
const {
  defineField,
  handleSubmit,
  resetForm,
  setFieldValue,
  isSubmitting,
  meta,
  errors,
} = useForm({
  validationSchema: schema,
  initialValues: defaults(props.settings),
})
const [apiKey, apiKeyProps] = defineField('apiKey')
const [username, usernameProps] = defineField('username')
const [password, passwordProps] = defineField('password')
const [deviceSearch] = defineField('deviceSearch')
const [autoDownload] = defineField('autoDownload')
const [languages] = defineField('languages')
const isBusy = computed(
  () => isSubmitting.value || checking.value || disconnecting.value,
)
const canSave = computed(
  () =>
    meta.value.dirty
    && (provider.value.configured
      || (!!apiKey.value?.trim()
        && (!open.value || (!!username.value?.trim() && !!password.value))))
      && (!open.value || !autoDownload.value || !!languages.value?.length),
)

watch(
  () => props.settings,
  (settings) => {
    if (!meta.value.dirty)
      resetForm({ values: defaults(settings) })
  },
)

function chooseLanguage(code: Language, checked: boolean) {
  const current = languages.value ?? []
  setFieldValue(
    'languages',
    checked
      ? [...new Set([...current, code])]
      : current.filter(item => item !== code),
  )
}

function saved(settings: SubtitleSettings) {
  result.value = undefined
  resetForm({ values: defaults(settings) })
  emit('saved', settings)
}

const save = handleSubmit(async (values) => {
  message.value = undefined
  const key = values.apiKey || undefined
  const update: UpdateSubtitleSettingsInput = open.value
    ? {
        openSubtitles: {
          apiKey: key,
          username: values.username || undefined,
          password: values.password || undefined,
          deviceSearch: values.deviceSearch,
          autoDownload: values.autoDownload,
          languages: props.settings.languages.filter(code =>
            values.languages.includes(code),
          ),
        },
      }
    : { subdl: { apiKey: key } }
  try {
    saved(
      await withErrorMode('silent', () =>
        api.settings.putSubtitleSettings(update)),
    )
  }
  catch {
    message.value = 'unavailable'
  }
})

async function check() {
  checking.value = true
  message.value = undefined
  try {
    result.value = await withErrorMode('silent', () =>
      api.settings.testSubtitleProvider(props.kind))
  }
  catch {
    result.value = { kind: 'unavailable' }
  }
  finally {
    checking.value = false
  }
}

async function disconnect() {
  disconnecting.value = true
  message.value = undefined
  try {
    saved(
      await withErrorMode('silent', () =>
        api.settings.putSubtitleSettings(
          open.value
            ? { openSubtitles: { disconnect: true } }
            : { subdl: { disconnect: true } },
        )),
    )
  }
  catch {
    message.value = 'unavailable'
  }
  finally {
    disconnecting.value = false
  }
}

function resetLabel(date: string) {
  return new Date(date).toLocaleString(locale.value.replace('_', '-'))
}
</script>

<template>
  <form @submit.prevent="save">
    <SettingsCard :title="providerName" description="">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-2">
          <Label :for="`${kind}-key`">{{ t(`${base}.apiKey`) }}</Label>
          <Input
            :id="`${kind}-key`"
            v-model="apiKey"
            v-bind="apiKeyProps"
            type="password"
            autocomplete="new-password"
            maxlength="1024"
            :aria-invalid="!!errors.apiKey"
          />
        </div>
        <template v-if="open">
          <div class="grid gap-2">
            <Label for="opensubtitles-username">{{
              t(`${base}.username`)
            }}</Label>
            <Input
              id="opensubtitles-username"
              v-model="username"
              v-bind="usernameProps"
              autocomplete="off"
              maxlength="1024"
              :aria-invalid="!!errors.username"
            />
          </div>
          <div class="grid gap-2">
            <Label for="opensubtitles-password">{{
              t(`${base}.password`)
            }}</Label>
            <Input
              id="opensubtitles-password"
              v-model="password"
              v-bind="passwordProps"
              type="password"
              autocomplete="new-password"
              maxlength="1024"
              :aria-invalid="!!errors.password"
            />
          </div>
        </template>
      </div>
      <template v-if="open">
        <div class="flex items-center gap-3">
          <Switch
            id="opensubtitles-devices"
            v-model="deviceSearch"
            :disabled="isBusy"
          />
          <Label for="opensubtitles-devices">{{
            t(`${base}.deviceSearch`)
          }}</Label>
        </div>
        <div class="flex items-center gap-3">
          <Switch
            id="opensubtitles-auto"
            v-model="autoDownload"
            :disabled="isBusy"
          />
          <Label for="opensubtitles-auto">{{
            t(`${base}.autoDownload`)
          }}</Label>
        </div>
        <fieldset v-if="autoDownload" class="min-w-0" :disabled="isBusy">
          <legend class="mb-2 text-sm font-medium">
            {{ t(`${base}.languages`) }}
          </legend>
          <div
            class="grid max-h-48 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <div
              v-for="code in settings.languages"
              :key="code"
              class="flex items-center gap-2"
            >
              <Checkbox
                :id="`subtitle-language-${code}`"
                :model-value="languages?.includes(code)"
                :disabled="
                  (languages?.length ?? 0) >= 12 && !languages?.includes(code)
                "
                @update:model-value="chooseLanguage(code, $event === true)"
              />
              <Label :for="`subtitle-language-${code}`">{{
                t(`subtitleLanguages.${code}`)
              }}</Label>
            </div>
          </div>
        </fieldset>
      </template>
      <p v-if="message" class="text-sm text-destructive" role="alert">
        {{ t(`${base}.${message}`) }}
      </p>
      <dl v-if="connection" class="grid gap-1 text-sm text-muted-foreground">
        <div
          v-if="connection.remainingDownloads !== undefined"
          class="flex justify-between gap-3"
        >
          <dt>{{ t(`${base}.remainingDownloads`) }}</dt>
          <dd>{{ connection.remainingDownloads }}</dd>
        </div>
        <div
          v-if="connection.remainingSearches !== undefined"
          class="flex justify-between gap-3"
        >
          <dt>{{ t(`${base}.remainingSearches`) }}</dt>
          <dd>{{ connection.remainingSearches }}</dd>
        </div>
        <div v-if="connection.resetAt" class="flex justify-between gap-3">
          <dt>{{ t(`${base}.resetAt`) }}</dt>
          <dd>{{ resetLabel(connection.resetAt) }}</dd>
        </div>
      </dl>
      <template #hint>
        <span role="status">{{ connectionLabel }}</span>
      </template>
      <template #action>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="provider.configured"
            type="button"
            variant="ghost"
            :disabled="isBusy"
            @click="disconnect"
          >
            {{ t(`${base}.disconnect`) }}
          </Button>
          <LoadingButton
            v-if="provider.configured"
            type="button"
            variant="outline"
            :loading="checking"
            :disabled="isBusy || meta.dirty"
            @click="check"
          >
            {{ t(`${base}.test`) }}
          </LoadingButton>
          <LoadingButton
            type="submit"
            :loading="isSubmitting"
            :disabled="!canSave || isBusy"
          >
            {{ t("panel.common.save") }}
          </LoadingButton>
        </div>
      </template>
    </SettingsCard>
  </form>
</template>
