<script setup lang="ts">
import type { IndexerManager } from '@torsher/api-client'
import type { SourceErrorKind } from '~/composables/useSources'
import { CircleAlertIcon, ExternalLinkIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { I18nT, useI18n } from 'vue-i18n'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { sourceErrorKind } from '~/composables/useSources'
import { dialogSheetClass } from '~/lib/dialog'
import { fieldOfSourceError, httpUrlSchema } from '~/lib/sourceForms'

const props = defineProps<{
  /** Новый ключ подключённого менеджера: тип и адрес уже известны */
  manager?: Pick<IndexerManager, 'kind' | 'url'>
}>()

const open = defineModel<boolean>('open', { required: true })

const KINDS: { kind: IndexerManager['kind'], port: number }[] = [
  { kind: 'prowlarr', port: 9696 },
  { kind: 'jackett', port: 9117 },
]

const ADDRESS_DOCS_URL = 'https://torsher.app/docs/setup/indexers?ref=panel'

const { t } = useI18n()
const { importManager } = useSources()

const serverError = ref<SourceErrorKind | null>(null)

const schema = toTypedSchema(
  z.object({
    kind: z.enum(['prowlarr', 'jackett']),
    url: httpUrlSchema(t('panel.sources.validation.url')),
    apiKey: z
      .string()
      .trim()
      .min(1, t('panel.sources.validation.apiKey'))
      .max(500),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  // Пустые строки, а не undefined: иначе пустое поле получает сообщение zod
  // о типе, а не текст из i18n
  initialValues: { kind: 'prowlarr' as const, url: '', apiKey: '' },
})

const [kind, kindProps] = defineField('kind')
const [url, urlProps] = defineField('url')
const [apiKey, apiKeyProps] = defineField('apiKey')

const port = computed(
  () => KINDS.find(item => item.kind === kind.value)?.port ?? 9696,
)
// Имя сервиса в compose совпадает с типом менеджера, как в файле установки
const serviceExample = computed(
  () => `http://${kind.value ?? 'prowlarr'}:${port.value}`,
)
const lanExample = computed(
  () => `http://<${t('panel.sources.importDialog.lanIp')}>:${port.value}`,
)
const errorField = computed(() =>
  serverError.value ? fieldOfSourceError(serverError.value) : null,
)

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm(
      props.manager && {
        values: {
          kind: props.manager.kind,
          url: props.manager.url,
          apiKey: '',
        },
      },
    )
    serverError.value = null
  }
})

const onSubmit = handleSubmit(async (values) => {
  serverError.value = null

  try {
    const result = await importManager(values)
    const manager = t(`panel.kinds.${values.kind}`)

    open.value = false

    if (props.manager) {
      toast.success(t('panel.sources.managers.keySaved', { manager }))
      return
    }

    toast.success(t('panel.sources.managers.imported', { manager }), {
      description:
        result.manager.indexerCount === 0
          ? t('panel.sources.managers.importedEmpty', { manager })
          : result.added > 0
            ? t('panel.sources.managers.importedText', result.added)
            : t('panel.sources.managers.synced', {
                added: result.added,
                updated: result.updated,
                missing: result.missing,
              }),
    })
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
            manager
              ? t("panel.sources.importDialog.keyTitle", {
                manager: t(`panel.kinds.${manager.kind}`),
              })
              : t("panel.sources.importDialog.title")
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            manager
              ? t("panel.sources.importDialog.keyDescription", {
                manager: t(`panel.kinds.${manager.kind}`),
              })
              : t("panel.sources.importDialog.description")
          }}
        </DialogDescription>
      </DialogHeader>

      <form
        id="import-manager"
        class="grid gap-4"
        novalidate
        @submit="onSubmit"
      >
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
          <Label id="manager-kind-label">{{
            t("panel.sources.importDialog.kind")
          }}</Label>
          <RadioGroup
            v-model="kind"
            v-bind="kindProps"
            class="grid-cols-2 gap-2"
            aria-labelledby="manager-kind-label"
          >
            <Label
              v-for="item in KINDS"
              :key="item.kind"
              :for="`manager-kind-${item.kind}`"
              class="flex cursor-pointer items-start justify-between gap-2 rounded-lg border border-input px-3 py-2.5 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
            >
              <span class="grid gap-1">
                <span class="font-semibold">{{
                  t(`panel.kinds.${item.kind}`)
                }}</span>
                <span class="text-xs text-muted-foreground">
                  {{
                    t("panel.sources.importDialog.port", { port: item.port })
                  }}
                </span>
              </span>
              <RadioGroupItem
                :id="`manager-kind-${item.kind}`"
                :value="item.kind"
              />
            </Label>
          </RadioGroup>
        </div>

        <div class="grid gap-2">
          <Label for="manager-url">{{
            t("panel.sources.importDialog.url")
          }}</Label>
          <Input
            id="manager-url"
            v-model="url"
            v-bind="urlProps"
            type="url"
            inputmode="url"
            autocomplete="off"
            class="font-mono"
            :placeholder="`http://192.168.1.10:${port}`"
            :aria-invalid="!!errors.url || errorField === 'url' || undefined"
            aria-describedby="manager-url-hint manager-url-examples"
          />
          <div class="grid gap-1">
            <p
              v-if="errors.url"
              id="manager-url-hint"
              class="text-[12.5px] text-destructive"
            >
              {{ errors.url }}
            </p>
            <p
              v-else
              id="manager-url-hint"
              class="text-[12.5px] text-muted-foreground"
            >
              {{ t("panel.sources.importDialog.urlHint") }}
            </p>
            <!-- Примеры не уступают место ошибке: поле не меняет высоту -->
            <p
              id="manager-url-examples"
              class="text-[12.5px] text-muted-foreground"
            >
              <I18nT keypath="panel.sources.importDialog.urlExamples">
                <template #service>
                  <span class="font-mono whitespace-nowrap text-foreground">{{
                    serviceExample
                  }}</span>
                </template>
                <template #lan>
                  <span class="font-mono whitespace-nowrap text-foreground">{{
                    lanExample
                  }}</span>
                </template>
              </I18nT>
              {{ " " }}
              <a
                :href="ADDRESS_DOCS_URL"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
              >
                {{ t("panel.sources.importDialog.urlHelp") }}
                <ExternalLinkIcon class="size-3.5" aria-hidden="true" />
              </a>
            </p>
          </div>
        </div>

        <div class="grid gap-2">
          <Label for="manager-api-key">{{
            t("panel.sources.importDialog.apiKey")
          }}</Label>
          <SecretInput
            id="manager-api-key"
            v-model="apiKey"
            v-bind="apiKeyProps"
            autocomplete="off"
            class="font-mono"
            :show-label="t('panel.common.showKey')"
            :hide-label="t('panel.common.hideKey')"
            :aria-invalid="
              !!errors.apiKey || errorField === 'apiKey' || undefined
            "
            aria-describedby="manager-api-key-hint"
          />
          <p
            v-if="errors.apiKey"
            id="manager-api-key-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.apiKey }}
          </p>
          <p
            v-else
            id="manager-api-key-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t(`panel.sources.importDialog.keyHint.${kind ?? "prowlarr"}`) }}
          </p>
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
        <LoadingButton
          type="submit"
          form="import-manager"
          :loading="isSubmitting"
        >
          {{
            manager
              ? t("panel.sources.importDialog.keySubmit")
              : t("panel.sources.importDialog.submit")
          }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
