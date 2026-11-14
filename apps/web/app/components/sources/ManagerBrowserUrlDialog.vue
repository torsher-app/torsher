<script setup lang="ts">
import type { IndexerManager } from '@torsher/api-client'
import { CircleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
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
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'
import { managerBrowserUrlSchema } from '~/lib/sourceForms'
import { getErrorMessage } from '~/services/api'
import ManagerBrowserUrlField from './ManagerBrowserUrlField.vue'

const props = defineProps<{ manager: IndexerManager }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const { saveManagerBrowserUrl } = useSources()
const formError = ref('')

const { handleSubmit, isSubmitting, resetForm } = useForm({
  validationSchema: toTypedSchema(
    z.object({
      browserUrl: managerBrowserUrlSchema(t('panel.sources.validation.url')),
    }),
  ),
  initialValues: { browserUrl: '' },
})

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm({ values: { browserUrl: props.manager.browserUrl ?? '' } })
    formError.value = ''
  }
})

const onSubmit = handleSubmit(async (values) => {
  formError.value = ''
  try {
    await saveManagerBrowserUrl(props.manager.id, values.browserUrl ?? null)
    open.value = false
    toast.success(t('panel.sources.browserUrl.saved'))
  }
  catch (err) {
    formError.value = await getErrorMessage(err)
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.sources.browserUrl.label") }}</DialogTitle>
        <DialogDescription>
          {{
            t("panel.sources.browserUrl.description", {
              manager: t(`panel.kinds.${manager.kind}`),
            })
          }}
        </DialogDescription>
      </DialogHeader>
      <form
        id="manager-browser-url-form"
        class="grid gap-4"
        novalidate
        @submit="onSubmit"
      >
        <Alert v-if="formError" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>
        <ManagerBrowserUrlField />
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
          form="manager-browser-url-form"
          :loading="isSubmitting"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
