<script setup lang="ts">
import type { BackupItem } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
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
import { formatDayTime } from '~/lib/backups'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{
  item: BackupItem | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const { removeBackup } = useBackups()

const isBusy = ref(false)
const date = computed(() =>
  props.item ? formatDayTime(props.item.createdAt, locale.value) : '',
)

async function onDelete() {
  if (!props.item)
    return

  isBusy.value = true

  try {
    await removeBackup(props.item.name)
    open.value = false
    toast.success(t('panel.backups.list.deleteDialog.deleted'), {
      description: date.value,
    })
  }
  finally {
    isBusy.value = false
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{ t("panel.backups.list.deleteDialog.title", { date }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.backups.list.deleteDialog.text") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isBusy">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          variant="destructive"
          :loading="isBusy"
          @click="onDelete"
        >
          {{ t("panel.common.delete") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
