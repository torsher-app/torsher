<script setup lang="ts">
import type { NotificationChannel } from '@torsher/api-client'
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
  channel: NotificationChannel | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { remove } = useNotificationChannels()
const shown = useLastValue(() => props.channel)

const isDeleting = ref(false)

async function onDelete() {
  if (!props.channel)
    return

  const { id, name } = props.channel

  isDeleting.value = true

  try {
    await remove(id)
    toast.success(t('panel.notifications.deleteDialog.deleted', { name }))
    open.value = false
  }
  finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{
            t("panel.notifications.deleteDialog.title", { name: shown?.name })
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.notifications.deleteDialog.text") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeleting">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          variant="destructive"
          :loading="isDeleting"
          @click="onDelete"
        >
          {{ t("panel.common.delete") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
