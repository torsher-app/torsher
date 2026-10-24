<script setup lang="ts">
import type { TorrentSettings } from '@torsher/api-client'
import { CircleAlertIcon, RotateCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
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
import { Button } from '@/components/ui/button'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'

/**
 * Сеть движок читает при запуске: сохранённое ждёт перезапуска. Сам он не
 * перезапускается — просмотр на всех устройствах прервётся, решает владелец
 */
defineProps<{
  settings: TorrentSettings
}>()

const { t } = useI18n()
const { restart } = useTorrentSettings()

const open = ref(false)
const isRestarting = ref(false)
const failed = ref(false)

watch(open, (isOpen) => {
  if (isOpen)
    failed.value = false
})

async function onRestart() {
  isRestarting.value = true
  failed.value = false

  try {
    await withErrorMode('silent', restart)
    open.value = false
    toast.success(t('panel.settings.torrent.restartDialog.toast'), {
      description: t('panel.settings.torrent.restartDialog.toastText'),
    })
  }
  catch {
    failed.value = true
  }
  finally {
    isRestarting.value = false
  }
}
</script>

<template>
  <Alert v-if="settings.pendingRestart.length > 0" variant="info">
    <RotateCwIcon />
    <AlertTitle>{{ t("panel.settings.torrent.restart.title") }}</AlertTitle>
    <AlertDescription class="grid justify-items-start gap-2.5">
      <span>
        {{
          settings.restartBlocked
            ? t(
              `panel.settings.torrent.restart.blocked.${settings.restartBlocked}`,
            )
            : t("panel.settings.torrent.restart.text")
        }}
      </span>
      <Button
        v-if="!settings.restartBlocked"
        variant="outline"
        size="sm"
        @click="open = true"
      >
        {{ t("panel.settings.torrent.restart.button") }}
      </Button>
    </AlertDescription>
  </Alert>

  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{ t("panel.settings.torrent.restartDialog.title") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("panel.settings.torrent.restartDialog.text") }}
          <template v-if="settings.activeStreams > 0">
            {{
              t(
                "panel.settings.torrent.restartDialog.watching",
                settings.activeStreams,
              )
            }}
          </template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Alert v-if="failed" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>
          {{
            t("panel.settings.torrent.restartDialog.error")
          }}
        </AlertTitle>
        <AlertDescription>
          {{ t("panel.settings.torrent.restartDialog.errorText") }}
        </AlertDescription>
      </Alert>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isRestarting">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton :loading="isRestarting" @click="onRestart">
          {{ t("panel.settings.torrent.restartDialog.submit") }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
