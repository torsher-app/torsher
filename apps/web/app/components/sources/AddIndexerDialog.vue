<script setup lang="ts">
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
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { sourceErrorKind } from '~/composables/useSources'
import { dialogSheetClass } from '~/lib/dialog'
import { fieldOfSourceError, httpUrlSchema } from '~/lib/sourceForms'

const props = defineProps<{
  /** Ручной индексатор для правки; без него диалог добавляет новый */
  indexer?: Indexer | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { createIndexer, updateIndexer } = useSources()

const serverError = ref<SourceErrorKind | null>(null)
const isEdit = computed(() => !!props.indexer)

// Адрес у индексатора не меняется (PATCH принимает имя и ключ), поэтому
// при правке поле адреса только для чтения и не проверяется
const optionalKey = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform(value => value || undefined)

const schema = computed(() =>
  toTypedSchema(
    z.object({
      name: z
        .string()
        .trim()
        .min(1, t('panel.sources.validation.name'))
        .max(100),
      url: isEdit.value
        ? z.string()
        : httpUrlSchema(t('panel.sources.validation.url')),
      // Пустое поле — индексатор без ключа или прежний ключ: на сервер не отправляем
      apiKey: optionalKey,
    }),
  ),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { name: '', url: '', apiKey: '' },
})

const [name, nameProps] = defineField('name')
const [url, urlProps] = defineField('url')
const [apiKey, apiKeyProps] = defineField('apiKey')

const errorField = computed(() =>
  serverError.value ? fieldOfSourceError(serverError.value) : null,
)

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm({
      values: {
        name: props.indexer?.name ?? '',
        url: props.indexer?.url ?? '',
        apiKey: '',
      },
    })
    serverError.value = null
  }
})

const onSubmit = handleSubmit(async (values) => {
  serverError.value = null

  try {
    if (props.indexer) {
      const checked = await updateIndexer(props.indexer.id, {
        name: values.name,
        apiKey: values.apiKey,
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
              : t("panel.sources.addDialog.title")
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
            {{
              t(`panel.sources.errorTitles.${serverError}`)
            }}
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
            :aria-invalid="!!errors.name || undefined"
          />
          <p v-if="errors.name" class="text-[12.5px] text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="indexer-url">{{
            t("panel.sources.addDialog.url")
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
            autocomplete="off"
            class="font-mono"
            :show-label="t('panel.common.showKey')"
            :hide-label="t('panel.common.hideKey')"
            :aria-invalid="
              !!errors.apiKey || errorField === 'apiKey' || undefined
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
                isEdit
                  ? "panel.sources.editDialog.apiKeyHint"
                  : "panel.sources.addDialog.apiKeyHint",
              )
            }}
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
