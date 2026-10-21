<script setup lang="ts">
import type { NetRoute } from '@torsher/api-client'
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
  route: NetRoute | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { deleteRoute } = useNetwork()

const isBusy = ref(false)

async function onDelete() {
  if (!props.route)
    return

  const { id, match } = props.route

  isBusy.value = true

  try {
    await deleteRoute(id)
    open.value = false
    toast.success(t('panel.settings.network.deleteDialog.deleted', { match }))
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
          {{
            t("panel.settings.network.deleteDialog.title", {
              match: route?.match,
            })
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.settings.network.deleteDialog.text") }}
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
