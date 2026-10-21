<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
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
import { sourceErrorKind } from '~/composables/useSources'
import { httpUrlSchema } from '~/lib/sourceForms'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { createIndexer } = useSources()

const formError = ref('')

const schema = toTypedSchema(
  z.object({
    name: z.string().trim().min(1, t('panel.sources.validation.name')).max(100),
    url: httpUrlSchema(t('panel.sources.validation.url')),
    // Пустое поле — индексатор без ключа: на сервер не отправляем
    apiKey: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform(value => value || undefined),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { name: '', url: '', apiKey: '' },
})

const [name, nameProps] = defineField('name')
const [url, urlProps] = defineField('url')
const [apiKey, apiKeyProps] = defineField('apiKey')

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm()
    formError.value = ''
  }
})

const onSubmit = handleSubmit(async (values) => {
  formError.value = ''

  try {
    const created = await createIndexer(values)

    open.value = false
    toast.success(t('panel.sources.addDialog.added', { name: created.name }))
  }
  catch (err) {
    formError.value = t(`panel.sources.errors.${await sourceErrorKind(err)}`)
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ t("panel.sources.addDialog.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("panel.sources.addDialog.description") }}
        </DialogDescription>
      </DialogHeader>

      <form id="add-indexer" class="grid gap-4" @submit="onSubmit">
        <div class="grid gap-2">
          <Label for="indexer-name">{{
            t("panel.sources.addDialog.name")
          }}</Label>
          <Input
            id="indexer-name"
            v-model="name"
            v-bind="nameProps"
            autocomplete="off"
          />
          <p v-if="errors.name" class="text-sm text-destructive">
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
            placeholder="https://indexer.example/api"
          />
          <p v-if="errors.url" class="text-sm text-destructive">
            {{ errors.url }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="indexer-api-key">{{
            t("panel.sources.addDialog.apiKey")
          }}</Label>
          <Input
            id="indexer-api-key"
            v-model="apiKey"
            v-bind="apiKeyProps"
            type="password"
            autocomplete="off"
            aria-describedby="indexer-api-key-hint"
          />
          <p id="indexer-api-key-hint" class="text-xs text-muted-foreground">
            {{ t("panel.sources.addDialog.apiKeyHint") }}
          </p>
          <p v-if="errors.apiKey" class="text-sm text-destructive">
            {{ errors.apiKey }}
          </p>
        </div>

        <p v-if="formError" class="text-sm text-destructive" role="alert">
          {{ formError }}
        </p>
      </form>

      <DialogFooter>
        <LoadingButton
          type="submit"
          form="add-indexer"
          class="w-full sm:w-auto"
          :loading="isSubmitting"
        >
          {{ t("panel.sources.addDialog.submit") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
