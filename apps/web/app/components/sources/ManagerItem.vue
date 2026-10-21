<script setup lang="ts">
import type { IndexerManager } from '@torsher/api-client'
import type { IndexersMode } from '~/composables/useSources'
import { RefreshCwIcon } from '@lucide/vue'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import LoadingButton from '~/components/LoadingButton.vue'
import { sourceErrorKind } from '~/composables/useSources'
import { formatDateTime } from '~/lib/format'

const props = defineProps<{
  manager: IndexerManager
}>()

const { t, locale } = useI18n()
const { syncManager, deleteManager } = useSources()

const isSyncing = ref(false)
const isDisconnecting = ref(false)
const isConfirmOpen = ref(false)

const name = computed(() => t(`panel.kinds.${props.manager.kind}`))

async function onSync() {
  isSyncing.value = true

  try {
    const result = await syncManager(props.manager.id)

    toast.success(
      t('panel.sources.managers.synced', {
        added: result.added,
        updated: result.updated,
        missing: result.missing,
      }),
    )
  }
  catch (err) {
    toast.error(t(`panel.sources.errors.${await sourceErrorKind(err)}`))
  }
  finally {
    isSyncing.value = false
  }
}

async function onDisconnect(mode: IndexersMode) {
  isDisconnecting.value = true

  try {
    await deleteManager(props.manager.id, mode)
    isConfirmOpen.value = false
    toast.success(
      t('panel.sources.managers.disconnected', { manager: name.value }),
    )
  }
  finally {
    isDisconnecting.value = false
  }
}
</script>

<template>
  <li class="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
    <div class="grid min-w-0 gap-1">
      <span class="font-medium">{{ name }}</span>
      <p class="text-sm break-all text-muted-foreground">
        {{ manager.url }}
      </p>
      <p class="text-xs text-muted-foreground">
        {{ t("panel.sources.managers.indexerCount", manager.indexerCount) }}
        <template v-if="manager.missingCount > 0">
          ·
          {{
            t("panel.sources.managers.missingCount", {
              n: manager.missingCount,
            })
          }}
        </template>
        <template v-if="manager.syncedAt">
          ·
          {{
            t("panel.sources.managers.syncedAt", {
              time: formatDateTime(manager.syncedAt, locale),
            })
          }}
        </template>
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="isSyncing"
        @click="onSync"
      >
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.sources.managers.sync") }}
      </LoadingButton>
      <AlertDialog v-model:open="isConfirmOpen">
        <AlertDialogTrigger as-child>
          <Button variant="ghost" size="sm">
            {{ t("panel.sources.managers.disconnect") }}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{
                t("panel.sources.managers.disconnectTitle", { manager: name })
              }}
            </AlertDialogTitle>
            <AlertDialogDescription class="break-words">
              {{
                t("panel.sources.managers.disconnectText", { url: manager.url })
              }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <!-- Два исхода: AlertDialogAction закрыл бы диалог до конца запроса -->
          <AlertDialogFooter>
            <AlertDialogCancel :disabled="isDisconnecting">
              {{ t("panel.common.cancel") }}
            </AlertDialogCancel>
            <Button
              variant="outline"
              :disabled="isDisconnecting"
              @click="onDisconnect('keep')"
            >
              {{ t("panel.sources.managers.keepIndexers") }}
            </Button>
            <Button
              variant="destructive"
              :disabled="isDisconnecting"
              @click="onDisconnect('delete')"
            >
              {{ t("panel.sources.managers.deleteIndexers") }}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </li>
</template>
