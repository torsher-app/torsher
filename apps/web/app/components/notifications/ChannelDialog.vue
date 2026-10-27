<script setup lang="ts">
import type { NotificationChannel } from '@torsher/api-client'
import type { ChannelKind } from '~/composables/useNotificationChannels'
import { language } from '@torsher/i18n'
import { CircleAlertIcon, CircleCheckIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { channelConfigFields } from '~/composables/useNotificationChannels'
import { dialogSheetClass } from '~/lib/dialog'
import {
  channelDefaults,
  channelEndpoints,
  channelFields,
  channelIcons,
  channelKindOrder,
  channelRequired,
  channelSecrets,
  notificationGroupOrder,
} from '~/lib/notificationChannels'
import ChannelField from './ChannelField.vue'
import TelegramChats from './TelegramChats.vue'

const props = defineProps<{
  // Правка существующего канала; без него — новый
  channel?: NotificationChannel
}>()

const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const { kinds, save, testDraft } = useNotificationChannels()

const kind = ref<ChannelKind | null>(null)
const formError = ref('')
const testResult = ref<{ ok: boolean, kind?: string } | null>(null)
const isTesting = ref(false)

const languages = Object.keys(language) as (keyof typeof language)[]
const availableKinds = computed(() =>
  channelKindOrder.filter(item => kinds.value.includes(item)),
)
const savedSecrets = computed(() => new Set(props.channel?.secrets ?? []))
// Сохранённые секреты, которые владелец решил удалить: уходят как `null`
const clearedSecrets = ref(new Set<string>())

const required = t('panel.notifications.validation.required')

/**
 * Адрес назначения изменился. Секретный адрес (URL вебхука) не виден:
 * введённое значение считается новым адресом.
 */
function endpointMoved(
  target: ChannelKind,
  config: Record<string, string | undefined>,
) {
  const channel = props.channel

  if (!channel || channel.kind !== target)
    return false

  return channelEndpoints[target].some((field) => {
    const value = config[field]?.trim() ?? ''

    return channelSecrets[target].includes(field)
      ? Boolean(value)
      : value !== String(channel.config[field] ?? '')
  })
}

/** Пустое поле оставит сохранённый секрет: не удалён и адрес тот же */
function keepsSavedSecret(
  target: ChannelKind,
  field: string,
  config: Record<string, string | undefined>,
) {
  return (
    channelSecrets[target].includes(field)
    && savedSecrets.value.has(field)
    && !clearedSecrets.value.has(field)
    && !endpointMoved(target, config)
  )
}

const schema = toTypedSchema(
  z
    .object({
      name: z.string().trim().min(1, required).max(80),
      language: z.enum(['ru_RU', 'en_US']),
      panelUrl: z.string().trim(),
      events: z.array(z.enum(notificationGroupOrder)),
      includeWarnings: z.boolean(),
      notifyResolved: z.boolean(),
      config: z.record(z.string(), z.string().optional()),
    })
    .superRefine((values, ctx) => {
      const current = kind.value

      if (values.panelUrl && !/^https?:\/\/\S+$/.test(values.panelUrl)) {
        ctx.addIssue({
          code: 'custom',
          path: ['panelUrl'],
          message: t('panel.notifications.validation.url'),
        })
      }

      if (!current)
        return

      for (const field of channelRequired[current]) {
        const keep = keepsSavedSecret(current, field, values.config)

        if (!values.config[field]?.trim() && !keep) {
          ctx.addIssue({
            code: 'custom',
            path: ['config', field],
            message: required,
          })
        }
      }
    }),
)

const {
  defineField,
  handleSubmit,
  resetForm,
  setFieldError,
  values,
  errors,
  isSubmitting,
  validate,
} = useForm({ validationSchema: schema })

const [name, nameProps] = defineField('name')
const [lang] = defineField('language')
const [panelUrl, panelUrlProps] = defineField('panelUrl')
const [events] = defineField('events')
const [includeWarnings] = defineField('includeWarnings')
const [notifyResolved] = defineField('notifyResolved')

function defaultPanelUrl() {
  return `${window.location.origin}${useRuntimeConfig().app.baseURL.replace(/\/+$/, '')}`
}

function configOf(target: ChannelKind, channel?: NotificationChannel) {
  const config: Record<string, string> = { ...channelDefaults[target] }

  for (const field of channelFields[target]) {
    const value = channel?.config[field]

    if (value !== undefined && value !== null)
      config[field] = String(value)
  }

  return config
}

function start(target: ChannelKind) {
  kind.value = target
  clearedSecrets.value = new Set()
  resetForm({
    values: {
      name: props.channel?.name ?? t(`panel.notifications.kinds.${target}`),
      language:
        props.channel?.language
        ?? (locale.value === 'ru_RU' ? 'ru_RU' : 'en_US'),
      panelUrl: props.channel?.panelUrl ?? defaultPanelUrl(),
      events: props.channel?.events ?? ['problems', 'updates', 'follow'],
      includeWarnings: props.channel?.includeWarnings ?? false,
      notifyResolved: props.channel?.notifyResolved ?? false,
      config: configOf(target, props.channel),
    },
  })
}

watch(open, (isOpen) => {
  if (!isOpen)
    return

  formError.value = ''
  testResult.value = null
  kind.value = null

  if (props.channel)
    start(props.channel.kind)
})

function toggleGroup(
  group: (typeof notificationGroupOrder)[number],
  checked: boolean | 'indeterminate',
) {
  const current = new Set(events.value ?? [])

  if (checked === true)
    current.add(group)
  else current.delete(group)

  events.value = notificationGroupOrder.filter(item => current.has(item))
}

/**
 * Только поля вида канала: пустой секрет при правке — оставить сохранённый,
 * `null` — удалить его.
 */
function bodyOf(formValues: typeof values) {
  const target = kind.value!
  const config: Record<string, string | null> = {}

  for (const field of channelFields[target]) {
    const raw = formValues.config?.[field]
    // Пробелы в пароле — его часть; токены обрезает сервер
    const value = channelSecrets[target].includes(field) ? raw : raw?.trim()

    if (value)
      config[field] = value
    else if (clearedSecrets.value.has(field))
      config[field] = null
  }

  return {
    kind: target,
    name: formValues.name ?? '',
    enabled: props.channel?.enabled ?? true,
    language: formValues.language ?? 'en_US',
    panelUrl: formValues.panelUrl?.trim() || null,
    config,
    events: formValues.events ?? [],
    includeWarnings: formValues.includeWarnings ?? false,
    notifyResolved: formValues.notifyResolved ?? false,
  }
}

async function applyServerError(err: unknown) {
  const fields = await channelConfigFields(err)

  if (!fields)
    return false

  for (const field of fields) {
    if (field === 'kind') {
      formError.value = t('panel.notifications.dialog.unknownKind')
    }
    else {
      setFieldError(
        `config.${field}`,
        t('panel.notifications.validation.invalid'),
      )
    }
  }

  return true
}

const onSubmit = handleSubmit(async (formValues) => {
  formError.value = ''

  try {
    await withErrorMode('silent', () =>
      save(bodyOf(formValues), props.channel?.id))
    toast.success(
      t(
        props.channel
          ? 'panel.notifications.dialog.saved'
          : 'panel.notifications.dialog.added',
      ),
    )
    open.value = false
  }
  catch (err) {
    if (!(await applyServerError(err)))
      formError.value = t('panel.notifications.dialog.saveFailed')
  }
})

async function onTest() {
  testResult.value = null

  const { valid } = await validate()

  if (!valid)
    return

  isTesting.value = true

  try {
    testResult.value = await testDraft({
      ...bodyOf(values),
      id: props.channel?.id,
    })
  }
  catch (err) {
    if (!(await applyServerError(err)))
      testResult.value = { ok: false, kind: 'unavailable' }
  }
  finally {
    isTesting.value = false
  }
}

const moved = computed(() =>
  Boolean(kind.value && endpointMoved(kind.value, values.config ?? {})),
)

/** Состояние сохранённого секрета для `ChannelField` */
function secretProps(field: string) {
  const target = kind.value

  return {
    'saved': savedSecrets.value.has(field),
    'moved': moved.value && !channelEndpoints[target!]?.includes(field),
    'removable': Boolean(target) && !channelRequired[target!].includes(field),
    'cleared': clearedSecrets.value.has(field),
    'onUpdate:cleared': (value: boolean) => {
      const next = new Set(clearedSecrets.value)

      if (value)
        next.add(field)
      else next.delete(field)

      clearedSecrets.value = next
    },
  }
}

const securityOptions = computed(() =>
  ['starttls', 'tls', 'none'].map(value => ({
    value,
    label: t(`panel.notifications.fields.security.${value}`),
  })),
)
const formatOptions = computed(() =>
  ['auto', 'discord', 'slack', 'json'].map(value => ({
    value,
    label: t(`panel.notifications.fields.format.${value}`),
  })),
)

const title = computed(() =>
  props.channel
    ? t('panel.notifications.dialog.editTitle')
    : kind.value
      ? t('panel.notifications.dialog.addKindTitle', {
          kind: t(`panel.notifications.kinds.${kind.value}`),
        })
      : t('panel.notifications.dialog.addTitle'),
)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[34rem]" :class="[dialogSheetClass]">
      <DialogHeader class="text-left">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          {{
            kind
              ? t(`panel.notifications.kindHints.${kind}`)
              : t("panel.notifications.dialog.chooseKind")
          }}
        </DialogDescription>
      </DialogHeader>

      <!-- Шаг 1: вид канала -->
      <div v-if="!kind" class="grid gap-2.5 sm:grid-cols-2">
        <button
          v-for="item in availableKinds"
          :key="item"
          type="button"
          class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-xl border border-input p-3.5 text-left outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
          @click="start(item)"
        >
          <component
            :is="channelIcons[item]"
            class="row-span-2 mt-0.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <span class="text-[13.5px] font-medium">{{
            t(`panel.notifications.kinds.${item}`)
          }}</span>
          <span class="text-[12.5px] text-muted-foreground">{{
            t(`panel.notifications.kindShort.${item}`)
          }}</span>
        </button>
      </div>

      <!-- Шаг 2: настройки -->
      <form
        v-else
        id="channel-form"
        class="grid gap-4"
        novalidate
        @submit="onSubmit"
      >
        <Alert v-if="formError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ formError }}</AlertTitle>
        </Alert>

        <div class="grid gap-2">
          <Label for="channel-name">{{
            t("panel.notifications.fields.name")
          }}</Label>
          <Input
            id="channel-name"
            v-model="name"
            v-bind="nameProps"
            autocomplete="off"
            :aria-invalid="Boolean(errors.name)"
          />
          <p v-if="errors.name" class="text-[12.5px] text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <template v-if="kind === 'telegram'">
          <ChannelField
            name="token"
            :label="t('panel.notifications.fields.botToken')"
            :hint="t('panel.notifications.fields.botTokenHint')"
            secret
            mono
            v-bind="secretProps('token')"
          />
          <ChannelField
            name="chatId"
            :label="t('panel.notifications.fields.chatId')"
            :hint="t('panel.notifications.fields.chatIdHint')"
            mono
          >
            <TelegramChats
              :token="values.config?.token"
              :channel-id="channel?.id"
            />
          </ChannelField>
        </template>

        <template v-else-if="kind === 'webhook'">
          <ChannelField
            name="url"
            :label="t('panel.notifications.fields.webhookUrl')"
            :hint="t('panel.notifications.fields.webhookUrlHint')"
            placeholder="https://"
            secret
            mono
            v-bind="secretProps('url')"
          />
          <ChannelField
            name="format"
            :label="t('panel.notifications.fields.format.label')"
            :hint="t('panel.notifications.fields.format.hint')"
            :options="formatOptions"
          />
          <ChannelField
            name="authorization"
            :label="t('panel.notifications.fields.authorization')"
            :hint="t('panel.notifications.fields.authorizationHint')"
            secret
            mono
            v-bind="secretProps('authorization')"
          />
        </template>

        <template v-else-if="kind === 'ntfy'">
          <ChannelField
            name="server"
            :label="t('panel.notifications.fields.server')"
            type="url"
            mono
          />
          <ChannelField
            name="topic"
            :label="t('panel.notifications.fields.topic')"
            :hint="t('panel.notifications.fields.topicHint')"
            mono
          />
          <ChannelField
            name="token"
            :label="t('panel.notifications.fields.accessToken')"
            :hint="t('panel.notifications.fields.accessTokenHint')"
            secret
            mono
            v-bind="secretProps('token')"
          />
        </template>

        <template v-else-if="kind === 'gotify'">
          <ChannelField
            name="server"
            :label="t('panel.notifications.fields.server')"
            placeholder="https://"
            type="url"
            mono
          />
          <ChannelField
            name="token"
            :label="t('panel.notifications.fields.appToken')"
            secret
            mono
            v-bind="secretProps('token')"
          />
        </template>

        <template v-else-if="kind === 'apprise'">
          <ChannelField
            name="server"
            :label="t('panel.notifications.fields.appriseServer')"
            :hint="t('panel.notifications.fields.appriseServerHint')"
            placeholder="http://apprise:8000"
            type="url"
            mono
          />
          <ChannelField
            name="key"
            :label="t('panel.notifications.fields.appriseKey')"
            :hint="t('panel.notifications.fields.appriseKeyHint')"
            mono
          />
          <ChannelField
            name="urls"
            :label="t('panel.notifications.fields.appriseUrls')"
            :hint="t('panel.notifications.fields.appriseUrlsHint')"
            secret
            mono
            v-bind="secretProps('urls')"
          />
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <ChannelField
              name="username"
              :label="t('panel.notifications.fields.username')"
            />
            <ChannelField
              name="password"
              :label="t('panel.notifications.fields.password')"
              secret
              v-bind="secretProps('password')"
            />
          </div>
        </template>

        <template v-else-if="kind === 'email'">
          <div class="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <ChannelField
              name="host"
              :label="t('panel.notifications.fields.smtpHost')"
              placeholder="smtp.example.com"
              mono
            />
            <ChannelField
              name="port"
              :label="t('panel.notifications.fields.port')"
              type="number"
              mono
            />
          </div>
          <ChannelField
            name="security"
            :label="t('panel.notifications.fields.security.label')"
            :options="securityOptions"
          />
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <ChannelField
              name="username"
              :label="t('panel.notifications.fields.username')"
            />
            <ChannelField
              name="password"
              :label="t('panel.notifications.fields.password')"
              secret
              v-bind="secretProps('password')"
            />
          </div>
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <ChannelField
              name="from"
              :label="t('panel.notifications.fields.from')"
              type="email"
            />
            <ChannelField
              name="to"
              :label="t('panel.notifications.fields.to')"
              type="email"
            />
          </div>
        </template>

        <fieldset class="grid gap-2.5">
          <legend class="mb-2 text-[13.5px] font-medium">
            {{ t("panel.notifications.fields.events") }}
          </legend>
          <template v-for="group in notificationGroupOrder" :key="group">
            <label
              class="flex cursor-pointer items-start gap-2.5 text-[13.5px]"
            >
              <Checkbox
                class="mt-0.5"
                :model-value="events?.includes(group)"
                @update:model-value="(checked) => toggleGroup(group, checked)"
              />
              <span class="grid gap-0.5">
                <span>{{ t(`panel.notifications.groups.${group}`) }}</span>
                <span class="text-[12.5px] text-muted-foreground">{{
                  t(`panel.notifications.groupHints.${group}`)
                }}</span>
              </span>
            </label>
            <!-- Уточнения проблем — под своей группой, с отступом -->
            <div
              v-if="group === 'problems' && events?.includes('problems')"
              class="ml-6.5 grid gap-2"
            >
              <label
                class="flex cursor-pointer items-center gap-2.5 text-[13px]"
              >
                <Checkbox v-model="includeWarnings" />
                {{ t("panel.notifications.fields.includeWarnings") }}
              </label>
              <label
                class="flex cursor-pointer items-center gap-2.5 text-[13px]"
              >
                <Checkbox v-model="notifyResolved" />
                {{ t("panel.notifications.fields.notifyResolved") }}
              </label>
            </div>
          </template>
        </fieldset>

        <div class="grid items-start gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="channel-language">{{
              t("panel.notifications.fields.language")
            }}</Label>
            <Select v-model="lang">
              <SelectTrigger id="channel-language" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="item in languages" :key="item" :value="item">
                  {{ language[item] }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[12.5px] text-muted-foreground">
              {{ t("panel.notifications.fields.languageHint") }}
            </p>
          </div>
          <div class="grid gap-2">
            <Label for="channel-panel-url">{{
              t("panel.notifications.fields.panelUrl")
            }}</Label>
            <Input
              id="channel-panel-url"
              v-model="panelUrl"
              v-bind="panelUrlProps"
              class="font-mono"
              type="url"
              autocomplete="off"
              :aria-invalid="Boolean(errors.panelUrl)"
            />
            <p v-if="errors.panelUrl" class="text-[12.5px] text-destructive">
              {{ errors.panelUrl }}
            </p>
            <p v-else class="text-[12.5px] text-muted-foreground">
              {{ t("panel.notifications.fields.panelUrlHint") }}
            </p>
          </div>
        </div>

        <Alert
          v-if="testResult"
          :variant="testResult.ok ? 'default' : 'destructive'"
          aria-live="polite"
        >
          <CircleCheckIcon v-if="testResult.ok" class="text-success!" />
          <CircleAlertIcon v-else />
          <AlertTitle>
            {{
              testResult.ok
                ? t("panel.notifications.test.ok")
                : t(
                  `panel.notifications.test.errors.${testResult.kind ?? "unavailable"}`,
                )
            }}
          </AlertTitle>
          <AlertDescription v-if="testResult.ok">
            {{ t("panel.notifications.test.okText") }}
          </AlertDescription>
        </Alert>
      </form>

      <DialogFooter v-if="kind" class="gap-2 sm:justify-between">
        <Button
          v-if="!channel"
          type="button"
          variant="ghost"
          @click="kind = null"
        >
          {{ t("panel.notifications.dialog.back") }}
        </Button>
        <span v-else />
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <LoadingButton
            type="button"
            variant="outline"
            :loading="isTesting"
            :disabled="isSubmitting"
            @click="onTest"
          >
            {{ t("panel.notifications.test.send") }}
          </LoadingButton>
          <LoadingButton
            type="submit"
            form="channel-form"
            :loading="isSubmitting"
          >
            {{ t("panel.common.save") }}
          </LoadingButton>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
