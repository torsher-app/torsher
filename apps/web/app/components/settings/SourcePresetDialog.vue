<script setup lang="ts">
import type { SourcePreset } from '@torsher/api-client'
import { getErrorMessage } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{ preset?: SourcePreset }>()
const emit = defineEmits<{ select: [id: string] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const { create, save } = useSourceSettings()
const formError = ref('')
const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: toTypedSchema(
    z.object({
      name: z
        .string()
        .trim()
        .min(1, t('panel.settings.sources.nameRequired'))
        .max(64, t('panel.settings.sources.nameLong')),
    }),
  ),
  initialValues: { name: '' },
})
const [name, nameProps] = defineField('name')
watch(open, (value) => {
  if (value) {
    formError.value = ''
    resetForm({ values: { name: props.preset?.name ?? '' } })
  }
})
const onSubmit = handleSubmit(async ({ name }) => {
  formError.value = ''
  try {
    const result = await withErrorMode('silent', () =>
      props.preset ? save(props.preset.id, { name }) : create(name))
    emit(
      'select',
      props.preset?.id ?? result.presets[result.presets.length - 1]!.id,
    )
    open.value = false
  }
  catch (error) {
    formError.value = await getErrorMessage(error)
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>
          {{
            t(
              preset
                ? "panel.settings.sources.rename"
                : "panel.settings.sources.create",
            )
          }}
        </DialogTitle>
        <DialogDescription>
          {{ t("panel.settings.sources.nameHint") }}
        </DialogDescription>
      </DialogHeader>
      <form id="source-preset-name" class="grid gap-3" @submit="onSubmit">
        <Alert v-if="formError" variant="destructive">
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>
        <Label for="source-preset-name-input">{{
          t("panel.settings.sources.name")
        }}</Label>
        <Input
          id="source-preset-name-input"
          v-model="name"
          v-bind="nameProps"
          :disabled="isSubmitting"
          :aria-invalid="!!errors.name"
          autocomplete="off"
        />
        <p v-if="errors.name" class="text-[12.5px] text-destructive">
          {{ errors.name }}
        </p>
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
          form="source-preset-name"
          :loading="isSubmitting"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
