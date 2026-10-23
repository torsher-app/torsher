<script setup lang="ts">
import type { Collection } from '@torsher/api-client'
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
  collection: Collection | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { remove } = useCollections()
const shown = useLastValue(() => props.collection)

const isDeleting = ref(false)

async function onDelete() {
  if (!props.collection)
    return

  const { id, name } = props.collection

  isDeleting.value = true

  try {
    await remove(id)
    toast.success(t('panel.collections.toasts.deleted', { name }))
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
          {{ t("panel.collections.deleteDialog.title", { name: shown?.name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            shown?.count
              ? t("panel.collections.deleteDialog.text", shown.count)
              : t("panel.collections.deleteDialog.textEmpty")
          }}
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
