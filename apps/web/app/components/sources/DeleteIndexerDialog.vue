<script setup lang="ts">
import type { Indexer } from '@torsher/api-client'
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
import { Button } from '@/components/ui/button'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'

const props = defineProps<{
  indexer: Indexer | null
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { deleteIndexer } = useSources()
const actions = useIndexerActions()
const status = useIndexerStatus()

const isBusy = ref(false)

// Индексатор менеджера вернёт следующая синхронизация: мягкий вариант — выключить
const isManaged = computed(
  () => !!props.indexer?.managerId && !props.indexer.missing,
)
const manager = computed(() =>
  props.indexer ? status.managerName(props.indexer) : '',
)

async function run(action: (indexer: Indexer) => Promise<void>) {
  if (!props.indexer)
    return

  isBusy.value = true

  try {
    await action(props.indexer)
    open.value = false
  }
  finally {
    isBusy.value = false
  }
}

function onDelete() {
  return run(async (indexer) => {
    await deleteIndexer(indexer.id)
    toast.success(t('panel.sources.indexers.deleted', { name: indexer.name }))
  })
}

function onDisable() {
  return run(indexer => actions.toggle(indexer, false))
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>
          {{ t("panel.sources.indexers.deleteTitle", { name: indexer?.name }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            isManaged
              ? t("panel.sources.indexers.deleteManagedText", { manager })
              : t("panel.sources.indexers.deleteText")
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isBusy">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <Button
          v-if="isManaged && indexer?.enabled"
          variant="outline"
          :disabled="isBusy"
          @click="onDisable"
        >
          {{ t("panel.sources.indexers.disableInstead") }}
        </Button>
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
