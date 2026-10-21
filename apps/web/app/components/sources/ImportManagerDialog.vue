<script setup lang="ts">
import type { IndexerManager } from '@torsher/api-client'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { sourceErrorKind } from '~/composables/useSources'
import { httpUrlSchema } from '~/lib/sourceForms'

const open = defineModel<boolean>('open', { required: true })

const KINDS: IndexerManager['kind'][] = ['prowlarr', 'jackett']
// Порты по умолчанию подсказывают, какой адрес ждём
const PLACEHOLDERS: Record<IndexerManager['kind'], string> = {
  prowlarr: 'http://192.168.1.10:9696',
  jackett: 'http://192.168.1.10:9117',
}

const { t } = useI18n()
const { importManager } = useSources()

const formError = ref('')

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

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm()
    formError.value = ''
  }
})

const onSubmit = handleSubmit(async (values) => {
  formError.value = ''

  try {
    const result = await importManager(values)

    open.value = false
    toast.success(
      t('panel.sources.managers.synced', {
        added: result.added,
        updated: result.updated,
        missing: result.missing,
      }),
    )
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
        <DialogTitle>{{ t("panel.sources.importDialog.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("panel.sources.importDialog.description") }}
        </DialogDescription>
      </DialogHeader>

      <form id="import-manager" class="grid gap-4" @submit="onSubmit">
        <div class="grid gap-2">
          <Label for="manager-kind">{{
            t("panel.sources.importDialog.kind")
          }}</Label>
          <Select v-model="kind" v-bind="kindProps">
            <SelectTrigger id="manager-kind" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in KINDS" :key="item" :value="item">
                {{ t(`panel.kinds.${item}`) }}
              </SelectItem>
            </SelectContent>
          </Select>
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
            :placeholder="PLACEHOLDERS[kind ?? 'prowlarr']"
          />
          <p v-if="errors.url" class="text-sm text-destructive">
            {{ errors.url }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="manager-api-key">{{
            t("panel.sources.importDialog.apiKey")
          }}</Label>
          <Input
            id="manager-api-key"
            v-model="apiKey"
            v-bind="apiKeyProps"
            type="password"
            autocomplete="off"
          />
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
          form="import-manager"
          class="w-full sm:w-auto"
          :loading="isSubmitting"
        >
          {{ t("panel.sources.importDialog.submit") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
