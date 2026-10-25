<script setup lang="ts">
import type { FollowSummary } from '@torsher/api-client'
import { getErrorMessage } from '@torsher/api-client'
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
import { Button } from '@/components/ui/button'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{
  follow: FollowSummary | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const store = useFollows()
const actions = useFollowActions()
const isDeleting = ref(false)

const name = computed(() => props.follow?.title ?? props.follow?.titleId ?? '')

async function onDelete() {
  const follow = props.follow

  if (!follow)
    return

  isDeleting.value = true

  try {
    await store.remove(follow.id)
    open.value = false
    toast.success(t('panel.follow.deleteDialog.done'), {
      description: name.value,
    })
  }
  catch (err) {
    toast.error(t('panel.follow.toasts.saveFailed'), {
      description: await getErrorMessage(err),
    })
  }
  finally {
    isDeleting.value = false
  }
}

// Мягкий вариант: пауза оставляет правила и подписки
async function onPause() {
  if (!props.follow)
    return

  await actions.togglePause(props.follow)
  open.value = false
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("panel.follow.deleteDialog.title", { name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.follow.deleteDialog.text") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeleting">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <Button
          v-if="follow?.state === 'active'"
          variant="outline"
          :disabled="isDeleting"
          @click="onPause"
        >
          {{ t("panel.follow.actions.pause") }}
        </Button>
        <LoadingButton
          variant="destructive"
          :loading="isDeleting"
          @click="onDelete"
        >
          {{ t("panel.follow.deleteDialog.confirm") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
