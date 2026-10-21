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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import { torrentErrorKind } from '~/composables/useTorrents'
import { dialogSheetClass } from '~/lib/dialog'
import { formatBytes } from '~/lib/format'

type Outcome = 'delete' | 'keep'

const props = defineProps<{
  torrent: Torrent | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const { deleteTorrent } = useTorrents()

const outcome = ref<Outcome>('delete')
const isBusy = ref(false)
const error = ref<TorrentErrorKind | null>(null)

watch(open, (isOpen) => {
  if (isOpen) {
    error.value = null
    outcome.value = 'delete'
  }
})

const size = computed(() =>
  formatBytes(props.torrent?.sizeOnDisk ?? 0, locale.value),
)

// Раздачу в движке удаляет и движок: без него ошибка остаётся в диалоге
async function onDelete() {
  if (!props.torrent)
    return

  const { id, name } = props.torrent
  const withFiles = outcome.value === 'delete'

  isBusy.value = true
  error.value = null

  try {
    await deleteTorrent(id, withFiles)
    open.value = false
    toast.success(t('panel.torrents.deleteDialog.deleted'), {
      description: withFiles
        ? t('panel.torrents.deleteDialog.deletedFiles')
        : name,
    })
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
          {{ t("panel.torrents.deleteDialog.title", { name: torrent?.name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.torrents.deleteDialog.text") }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <!-- Два исхода — радио-опции, кнопка одна -->
      <RadioGroup v-model="outcome" class="gap-2">
        <Label
          v-for="item in ['delete', 'keep'] as const"
          :key="item"
          :for="`delete-outcome-${item}`"
          class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary"
        >
          <RadioGroupItem
            :id="`delete-outcome-${item}`"
            :value="item"
            class="mt-0.5"
          />
          <span class="grid gap-0.5">
            <span class="font-medium">{{
              t(
                item === "delete"
                  ? "panel.torrents.deleteDialog.withFiles"
                  : "panel.torrents.deleteDialog.keepFiles",
              )
            }}</span>
            <span class="text-[12.5px] text-muted-foreground">{{
              item === "keep"
                ? t("panel.torrents.deleteDialog.keepFilesText")
                : torrent?.sizeOnDisk
                  ? t("panel.torrents.deleteDialog.withFilesText", { size })
                  : t("panel.torrents.deleteDialog.withFilesEmpty")
            }}</span>
          </span>
        </Label>
      </RadioGroup>

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
          @click="onDelete"
        >
          {{ t("panel.common.delete") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
