<script setup lang="ts">
import type { TorrentErrorKind } from '~/composables/useTorrents'
import { CircleAlertIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { torrentErrorKind } from '~/composables/useTorrents'
import { dialogSheetClass } from '~/lib/dialog'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { restartEngine } = useTorrents()

const isRestarting = ref(false)
const error = ref<TorrentErrorKind | null>(null)

watch(open, (isOpen) => {
  if (isOpen)
    error.value = null
})

async function onRestart() {
  isRestarting.value = true
  error.value = null

  try {
    await restartEngine()
    open.value = false
  }
  catch (err) {
    error.value = await torrentErrorKind(err)
  }
  finally {
    isRestarting.value = false
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{ t("panel.torrents.restartDialog.title") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.torrents.restartDialog.text") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Alert v-if="error" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{{ t(`panel.torrents.errorTitles.${error}`) }}</AlertTitle>
        <AlertDescription>
          {{ t(`panel.torrents.errors.${error}`) }}
        </AlertDescription>
      </Alert>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isRestarting">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton :loading="isRestarting" @click="onRestart">
          {{ t("panel.torrents.restartDialog.submit") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
