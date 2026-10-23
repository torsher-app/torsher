<script setup lang="ts">
import type { Torrent } from '@torsher/api-client'
import type { TorrentErrorKind } from '~/composables/useTorrents'
import { CircleAlertIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
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

const props = defineProps<{
  torrent: Torrent | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { removeFromLibrary } = useTorrents()

const isBusy = ref(false)
const error = ref<TorrentErrorKind | null>(null)

watch(open, (isOpen) => {
  if (isOpen)
    error.value = null
})

// Раздачи на диске нет — в библиотеке последняя копия файлов
const isLastCopy = computed(() => (props.torrent?.sizeOnDisk ?? 0) === 0)

async function onRemove() {
  if (!props.torrent)
    return

  const { id, name } = props.torrent

  isBusy.value = true
  error.value = null

  try {
    await removeFromLibrary(id)
    open.value = false
    toast.success(t('panel.torrents.removeDialog.done'), { description: name })
  }
  catch (err) {
    error.value = await torrentErrorKind(err)
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
        <AlertDialogTitle class="break-all">
          {{ t("panel.torrents.removeDialog.title", { name: torrent?.name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t(
              isLastCopy
                ? "panel.torrents.removeDialog.lastCopy"
                : "panel.torrents.removeDialog.text",
            )
          }}
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
        <AlertDialogCancel :disabled="isBusy">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          variant="destructive"
          :loading="isBusy"
          @click="onRemove"
        >
          {{ t("panel.torrents.removeLibrary") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
