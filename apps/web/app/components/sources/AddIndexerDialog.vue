<script setup lang="ts">
import type { UsenetNetworkApproval } from './UsenetAddressApproval.vue'
import type { Indexer } from '@torsher/api-client'
import type { SourceErrorKind } from '~/composables/useSources'
import { CircleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { sourceErrorKind } from '~/composables/useSources'
import { dialogSheetClass } from '~/lib/dialog'
import {
  fieldOfSourceError,
  httpUrlSchema,
  indexerUpdateBody,
  isSessionCookie,
} from '~/lib/sourceForms'

import UsenetAddressApproval from './UsenetAddressApproval.vue'
import UsenetOriginsField from './UsenetOriginsField.vue'

const props = defineProps<{
  /** Индексатор для правки; без него диалог добавляет новый */
  indexer?: Indexer | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { createIndexer, updateIndexer } = useSources()

const usenetSupported = useState<boolean>('usenet-supported', () => false)
const isNewznab = ref(false)
const lanAddresses = ref<string[]>()
const downloadOrigins = ref<UsenetNetworkApproval[]>([])
const serverError = ref<SourceErrorKind | null>(null)
const isEdit = computed(() => !!props.indexer)
const managed = computed(() => !!props.indexer?.managerId)

// Адрес у индексатора не меняется (PATCH принимает имя и ключ), поэтому
// при правке поле адреса только для чтения и не проверяется
const optionalKey = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform(value => value || undefined)
const thresholdInput = z.union([z.string(), z.number()]).transform((value) => {
  const text = String(value).trim()
  return text ? Number(text) : null
})

const schema = computed(() =>
  toTypedSchema(
    z.object({
      name: managed.value
        ? z.string()
        : z.string().trim().min(1, t('panel.sources.validation.name')).max(100),
      url: isEdit.value
        ? z.string()
        : httpUrlSchema(t('panel.sources.validation.url')),
      // Пустое поле — индексатор без ключа или прежний ключ: на сервер не отправляем
      apiKey: optionalKey,
      sessionCookie: z
        .string()
        .max(8192, t('panel.sources.validation.sessionCookie'))
        .refine(
          value => !value || isSessionCookie(value),
          t('panel.sources.validation.sessionCookie'),
        )
        .optional()
        .transform(value => value || undefined),
      removeCookie: z.boolean(),
      isPrivate: z.boolean(),
      allowAutomation: z.boolean(),
      minSeedRatio: thresholdInput.pipe(
        z
          .number({ error: t('panel.settings.torrent.validation.number') })
          .positive(t('panel.settings.torrent.validation.number'))
          .nullable(),
      ),
      minSeedTimeMinutes: thresholdInput.pipe(
        z
          .number({ error: t('panel.settings.torrent.validation.integer') })
          .int(t('panel.settings.torrent.validation.integer'))
          .positive(t('panel.settings.torrent.validation.integer'))
          .nullable(),
      ),
      seedCriteriaMode: z.enum(['automatic', 'or', 'and']),
    }),
  ),
)

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  resetForm,
  setFieldValue,
} = useForm({
  validationSchema: schema,
  initialValues: {
    name: '',
    url: '',
    apiKey: '',
    sessionCookie: '',
    removeCookie: false,
    isPrivate: false,
    allowAutomation: true,
    minSeedRatio: '',
    minSeedTimeMinutes: '',
    seedCriteriaMode: 'automatic',
  },
})

const [name, nameProps] = defineField('name')
const [url, urlProps] = defineField('url')
const [apiKey, apiKeyProps] = defineField('apiKey')
const [sessionCookie, sessionCookieProps] = defineField('sessionCookie')
const [removeCookie] = defineField('removeCookie')
const [isPrivate] = defineField('isPrivate')
const [allowAutomation] = defineField('allowAutomation')
const [minSeedRatio] = defineField('minSeedRatio')
const [minSeedTimeMinutes] = defineField('minSeedTimeMinutes')
const [seedCriteriaMode] = defineField('seedCriteriaMode')

function approveAddress(item: UsenetNetworkApproval) {
  lanAddresses.value = item.lanAddresses
}

watch(url, () => {
  lanAddresses.value = undefined
})

const errorField = computed(() =>
  serverError.value ? fieldOfSourceError(serverError.value) : null,
)

watch(open, (isOpen) => {
  if (isOpen) {
    isNewznab.value = props.indexer?.protocol === 'newznab'
    lanAddresses.value = undefined
    downloadOrigins.value = [...(props.indexer?.downloadOrigins ?? [])]
    resetForm({
      values: {
        name: props.indexer?.name ?? '',
        url: props.indexer?.url ?? '',
        apiKey: '',
        sessionCookie: '',
        removeCookie: false,
        isPrivate: props.indexer?.isPrivate ?? false,
        allowAutomation: props.indexer?.allowAutomation ?? true,
        minSeedRatio: props.indexer?.minSeedRatio ?? '',
        minSeedTimeMinutes: props.indexer?.minSeedTimeMinutes ?? '',
        seedCriteriaMode: props.indexer?.seedCriteriaMode ?? 'automatic',
      },
    })
    serverError.value = null
  }
})

const onSubmit = handleSubmit(async (values) => {
  serverError.value = null
  const policy = {
    allowAutomation: values.allowAutomation,
    ...(!isNewznab.value && {
      isPrivate: values.isPrivate,
      minSeedRatio: values.minSeedRatio,
      minSeedTimeMinutes: values.minSeedTimeMinutes,
      seedCriteriaMode:
        values.seedCriteriaMode === 'automatic'
          ? null
          : values.seedCriteriaMode,
    }),
  } as const
  const approvals = isNewznab.value
    ? {
        lanAddresses: lanAddresses.value,
        downloadOrigins: downloadOrigins.value,
      }
    : {}

  try {
    if (props.indexer) {
      const current = props.indexer
      const changes = Object.fromEntries(
        Object.entries(policy).filter(
          ([key, value]) => current[key as keyof typeof policy] !== value,
        ),
      )
      const checked = await updateIndexer(current.id, {
        ...indexerUpdateBody(
          isNewznab.value
            ? { ...values, sessionCookie: undefined, removeCookie: false }
            : values,
          managed.value,
        ),
        ...changes,
        ...approvals,
      })

      // Новый ключ не прошёл проверку: диалог остаётся открытым с причиной
      if (checked && checked.checkStatus !== 'ok') {
        serverError.value = checked.checkStatus ?? 'unknown'
        return
      }

      open.value = false
      toast.success(t('panel.sources.editDialog.saved', { name: values.name }))
      return
    }

    const created = await createIndexer({
      name: values.name,
      url: values.url,
      apiKey: values.apiKey,
      ...(isNewznab.value
        ? { protocol: 'newznab' as const, ...approvals }
        : { sessionCookie: values.sessionCookie }),
      ...policy,
    })

    open.value = false
    toast.success(t('panel.sources.addDialog.added', { name: created.name }))
  }
  catch (err) {
    serverError.value = await sourceErrorKind(err)
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>
          {{
            isEdit
              ? t("panel.sources.editDialog.title", { name: indexer?.name })
              : t(
                isNewznab
                  ? "usenet.newznab"
                  : "panel.sources.addDialog.title",
              )
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            isEdit
              ? t("panel.sources.editDialog.description")
              : t("panel.sources.addDialog.description")
          }}
        </DialogDescription>
      </DialogHeader>

      <form id="add-indexer" class="grid gap-4" novalidate @submit="onSubmit">
        <Alert v-if="serverError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            {{ t(`panel.sources.errorTitles.${serverError}`) }}
          </AlertTitle>
          <AlertDescription>
            {{ t(`panel.sources.errors.${serverError}`) }}
          </AlertDescription>
        </Alert>

        <div class="grid gap-2">
          <Label for="indexer-name">{{
            t("panel.sources.addDialog.name")
          }}</Label>
          <Input
            id="indexer-name"
            v-model="name"
            v-bind="nameProps"
            autocomplete="off"
            :placeholder="t('panel.sources.addDialog.namePlaceholder')"
            :readonly="managed"
            :aria-invalid="!!errors.name || undefined"
          />
          <p v-if="errors.name" class="text-[12.5px] text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <fieldset v-if="usenetSupported || isNewznab" class="grid gap-2">
          <legend class="text-sm">
            {{ t("usenet.protocol") }}
          </legend>
          <div class="flex items-center justify-between gap-3">
            <Label for="indexer-protocol">{{ t("usenet.newznab") }}</Label>
            <Switch
              id="indexer-protocol"
              v-model="isNewznab"
              :disabled="isEdit || isSubmitting"
            />
          </div>
        </fieldset>

        <div class="grid gap-2">
          <Label for="indexer-url">{{
            t(
              isNewznab
                ? "panel.sources.importDialog.url"
                : "panel.sources.addDialog.url",
            )
          }}</Label>
          <Input
            id="indexer-url"
            v-model="url"
            v-bind="urlProps"
            type="url"
            inputmode="url"
            autocomplete="off"
            class="font-mono"
            placeholder="https://indexer.example/api"
            :readonly="isEdit"
            :aria-invalid="!!errors.url || errorField === 'url' || undefined"
          />
          <p v-if="errors.url" class="text-[12.5px] text-destructive">
            {{ errors.url }}
          </p>
          <UsenetAddressApproval
            v-if="isNewznab"
            :url="url"
            :disabled="isSubmitting"
            @approve="approveAddress"
          />
          <p
            v-if="isNewznab && lanAddresses?.length"
            class="font-mono text-xs break-all"
          >
            {{ lanAddresses.join(" · ") }}
          </p>
        </div>

        <div class="grid gap-2">
          <div class="flex items-baseline justify-between gap-3">
            <Label for="indexer-api-key">{{
              t(
                isEdit
                  ? "panel.sources.editDialog.apiKey"
                  : "panel.sources.addDialog.apiKey",
              )
            }}</Label>
            <span class="text-[12.5px] text-muted-foreground">{{
              t("panel.common.optional")
            }}</span>
          </div>
          <SecretInput
            id="indexer-api-key"
            v-model="apiKey"
            v-bind="apiKeyProps"
            :readonly="managed"
            :placeholder="
              managed && indexer?.hasApiKey ? '••••••••' : undefined
            "
            autocomplete="off"
            class="font-mono"
            :show-label="t('panel.common.showKey')"
            :hide-label="t('panel.common.hideKey')"
            :aria-invalid="
              !!errors.apiKey
                || (errorField === 'apiKey' && !managed)
                || undefined
            "
            aria-describedby="indexer-api-key-hint"
          />
          <p
            v-if="errors.apiKey"
            id="indexer-api-key-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.apiKey }}
          </p>
          <p
            v-else
            id="indexer-api-key-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{
              t(
                managed
                  ? "panel.sources.cookie.managedKey"
                  : isEdit
                    ? "panel.sources.editDialog.apiKeyHint"
                    : "panel.sources.addDialog.apiKeyHint",
              )
            }}
          </p>
        </div>
        <UsenetOriginsField
          v-if="isNewznab"
          v-model="downloadOrigins"
          :disabled="isSubmitting"
        />
        <div v-if="!isNewznab" class="grid gap-2">
          <Label for="indexer-session-cookie">{{
            t("panel.sources.cookie.label")
          }}</Label>
          <SecretInput
            id="indexer-session-cookie"
            v-model="sessionCookie"
            v-bind="sessionCookieProps"
            autocomplete="off"
            autocapitalize="off"
            :spellcheck="false"
            class="font-mono"
            :placeholder="
              indexer?.hasCookie && !removeCookie ? '••••••••' : undefined
            "
            :show-label="t('panel.sources.cookie.show')"
            :hide-label="t('panel.sources.cookie.hide')"
            :aria-invalid="
              !!errors.sessionCookie
                || (errorField === 'apiKey'
                  && !!(sessionCookie || indexer?.hasCookie))
                || undefined
            "
            aria-describedby="indexer-cookie-hint"
          />
          <p
            v-if="errors.sessionCookie"
            id="indexer-cookie-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.sessionCookie }}
          </p>
          <p
            v-else
            id="indexer-cookie-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{
              t(
                removeCookie
                  ? "panel.sources.cookie.removing"
                  : indexer?.hasCookie
                    ? "panel.sources.cookie.saved"
                    : "panel.sources.cookie.hint",
              )
            }}
          </p>
          <Button
            v-if="indexer?.hasCookie && !sessionCookie"
            type="button"
            variant="ghost"
            size="sm"
            class="justify-self-start"
            @click="setFieldValue('removeCookie', !removeCookie)"
          >
            {{
              t(
                removeCookie
                  ? "panel.sources.cookie.undoRemove"
                  : "panel.sources.cookie.remove",
              )
            }}
          </Button>
          <p class="text-[12.5px] text-muted-foreground">
            {{ t("panel.sources.cookie.scope") }}
          </p>
        </div>
        <div class="grid gap-4 border-t pt-4">
          <div
            v-if="!isNewznab"
            class="flex items-center justify-between gap-3"
          >
            <Label for="indexer-private">{{
              t("panel.sources.privatePolicy.private")
            }}</Label>
            <Switch id="indexer-private" v-model="isPrivate" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <Label for="indexer-automation">{{
              t("panel.sources.privatePolicy.automation")
            }}</Label>
            <Switch id="indexer-automation" v-model="allowAutomation" />
          </div>
          <template v-if="isPrivate && !isNewznab">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="grid gap-2">
                <Label for="indexer-seed-ratio">{{
                  t("panel.sources.privatePolicy.ratio")
                }}</Label>
                <Input
                  id="indexer-seed-ratio"
                  v-model="minSeedRatio"
                  type="number"
                  step="any"
                  inputmode="decimal"
                  :aria-invalid="!!errors.minSeedRatio || undefined"
                />
                <p v-if="errors.minSeedRatio" class="text-xs text-destructive">
                  {{ errors.minSeedRatio }}
                </p>
              </div>
              <div class="grid gap-2">
                <Label for="indexer-seed-time">{{
                  t("panel.sources.privatePolicy.time")
                }}</Label>
                <Input
                  id="indexer-seed-time"
                  v-model="minSeedTimeMinutes"
                  type="number"
                  step="1"
                  inputmode="numeric"
                  :aria-invalid="!!errors.minSeedTimeMinutes || undefined"
                />
                <p
                  v-if="errors.minSeedTimeMinutes"
                  class="text-xs text-destructive"
                >
                  {{ errors.minSeedTimeMinutes }}
                </p>
              </div>
            </div>
            <div class="grid gap-2">
              <Label for="indexer-seed-mode">{{
                t("panel.sources.privatePolicy.mode")
              }}</Label>
              <Select v-model="seedCriteriaMode">
                <SelectTrigger id="indexer-seed-mode" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="mode in ['automatic', 'or', 'and'] as const"
                    :key="mode"
                    :value="mode"
                  >
                    {{ t(`panel.sources.privatePolicy.${mode}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </template>
        </div>
      </form>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isSubmitting"
          @click="open = false"
        >
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton type="submit" form="add-indexer" :loading="isSubmitting">
          {{
            isEdit
              ? t("panel.common.save")
              : t("panel.sources.addDialog.submit")
          }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
