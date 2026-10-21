<script setup lang="ts">
import type { Device } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{
  device: Device | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { rename } = useDevices()
const shown = useLastValue(() => props.device)

const schema = computed(() =>
  toTypedSchema(
    z.object({
      name: z
        .string()
        .trim()
        .min(1, t('panel.people.validation.deviceName'))
        .max(60),
    }),
  ),
)

const { handleSubmit, defineField, errors, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { name: '' },
})

const [name, nameProps] = defineField('name')

watch(open, (isOpen) => {
  if (isOpen)
    resetForm({ values: { name: props.device?.name ?? '' } })
})

const onSubmit = handleSubmit(async (values) => {
  if (!props.device)
    return

  const updated = await rename(props.device.id, values.name)

  toast.success(
    t('panel.people.devices.toasts.renamed', { name: updated.name }),
  )
  open.value = false
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>
          {{
            t("panel.people.devices.renameDialog.title", { name: shown?.name })
          }}
        </DialogTitle>
      </DialogHeader>

      <form id="rename-device" class="grid gap-2" novalidate @submit="onSubmit">
        <Label for="device-name">{{
          t("panel.people.devices.renameDialog.label")
        }}</Label>
        <Input
          id="device-name"
          v-model="name"
          v-bind="nameProps"
          autocomplete="off"
          :aria-invalid="!!errors.name || undefined"
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
          form="rename-device"
          :loading="isSubmitting"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
