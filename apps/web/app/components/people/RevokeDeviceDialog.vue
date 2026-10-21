<script setup lang="ts">
import type { Device } from '@torsher/api-client'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{
  device: Device | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { revoke } = useDevices()
const shown = useLastValue(() => props.device)

const isRevoking = ref(false)

async function onRevoke() {
  if (!props.device)
    return

  const { id, name } = props.device

  isRevoking.value = true

  try {
    await revoke(id)
    toast.success(t('panel.people.devices.toasts.revoked', { name }))
    open.value = false
  }
  finally {
    isRevoking.value = false
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{
            t("panel.people.devices.revokeDialog.title", { name: shown?.name })
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.people.devices.revokeDialog.text") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isRevoking">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          variant="destructive"
          :loading="isRevoking"
          @click="onRevoke"
        >
          {{ t("panel.people.devices.revokeDialog.submit") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
