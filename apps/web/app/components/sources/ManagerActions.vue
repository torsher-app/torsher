<script setup lang="ts">
import type { IndexerManager } from '@torsher/api-client'
import {
  EllipsisIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  UnplugIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { sourceErrorKind } from '~/composables/useSources'
import DisconnectManagerDialog from './DisconnectManagerDialog.vue'

const props = defineProps<{
  manager: IndexerManager
}>()

const { t } = useI18n()
const { syncManager } = useSources()

const isSyncing = ref(false)
const isDisconnectOpen = ref(false)

const name = computed(() => t(`panel.kinds.${props.manager.kind}`))

async function onSync() {
  isSyncing.value = true

  try {
    const result = await syncManager(props.manager.id)

    toast.success(
      t('panel.sources.managers.syncedTitle', { manager: name.value }),
      {
        description: t('panel.sources.managers.synced', {
          added: result.added,
          updated: result.updated,
          missing: result.missing,
        }),
      },
    )
  }
  catch (err) {
    toast.error(
      t('panel.sources.managers.syncFailed', { manager: name.value }),
      {
        description: t(`panel.sources.errors.${await sourceErrorKind(err)}`),
      },
    )
  }
  finally {
    isSyncing.value = false
  }
}
</script>

<template>
  <Button
    variant="ghost"
    size="icon-sm"
    class="size-7"
    :disabled="isSyncing"
    :aria-busy="isSyncing"
    :aria-label="t('panel.sources.managers.sync', { manager: name })"
    :title="t('panel.sources.managers.sync', { manager: name })"
    @click="onSync"
  >
    <Loader2Icon v-if="isSyncing" class="animate-spin" />
    <RefreshCwIcon v-else />
  </Button>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="size-7"
        :aria-label="t('panel.sources.indexers.actions', { name })"
      >
        <EllipsisIcon />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-auto min-w-52">
      <DropdownMenuItem as-child>
        <a :href="manager.url" target="_blank" rel="noopener noreferrer">
          <ExternalLinkIcon aria-hidden="true" />
          {{ t("panel.sources.managers.open", { manager: name }) }}
        </a>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" @select="isDisconnectOpen = true">
        <UnplugIcon aria-hidden="true" />
        {{ t("panel.sources.managers.disconnect") }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  <DisconnectManagerDialog v-model:open="isDisconnectOpen" :manager="manager" />
</template>
