<script setup lang="ts">
import type { Indexer } from '@torsher/api-client'
import { Trash2Icon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatDateTime, hostOf } from '~/lib/format'
import IndexerStatus from './IndexerStatus.vue'

const props = defineProps<{
  indexer: Indexer
}>()

// Категорий у индексатора бывают десятки: в списке — первые, остальное числом
const VISIBLE_CATEGORIES = 3

const { t, locale } = useI18n()
const { setEnabled, testIndexer, deleteIndexer } = useSources()

const isTesting = ref(false)
const isToggling = ref(false)

const managerName = computed(() =>
  props.indexer.managerKind
    ? t(`panel.kinds.${props.indexer.managerKind}`)
    : '',
)
const source = computed(() => {
  if (props.indexer.missing)
    return t('panel.sources.indexers.missing', { manager: managerName.value })

  return managerName.value || t('panel.sources.indexers.manual')
})
const hiddenCategories = computed(
  () => props.indexer.categories.length - VISIBLE_CATEGORIES,
)

async function onToggle(enabled: boolean) {
  isToggling.value = true

  try {
    await setEnabled(props.indexer, enabled)
  }
  finally {
    isToggling.value = false
  }
}

async function onTest() {
  isTesting.value = true

  try {
    const checked = await testIndexer(props.indexer.id)
    const name = checked.name

    if (checked.checkStatus === 'ok') {
      toast.success(t('panel.sources.indexers.testPassed', { name }))
    }
    else {
      toast.error(
        t('panel.sources.indexers.testFailed', {
          name,
          status: t(`panel.sources.status.${checked.checkStatus ?? 'pending'}`),
        }),
      )
    }
  }
  finally {
    isTesting.value = false
  }
}

async function onDelete() {
  await deleteIndexer(props.indexer.id)
  toast.success(
    t('panel.sources.indexers.deleted', { name: props.indexer.name }),
  )
}
</script>

<template>
  <li
    class="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
    :class="{ 'opacity-60': !indexer.enabled }"
  >
    <div class="grid min-w-0 gap-1.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium break-words">{{ indexer.name }}</span>
        <IndexerStatus :status="indexer.checkStatus" />
      </div>
      <p class="text-sm break-all text-muted-foreground">
        {{ hostOf(indexer.url) }} · {{ source }}
      </p>
      <div v-if="indexer.categories.length > 0" class="flex flex-wrap gap-1">
        <Badge
          v-for="category in indexer.categories.slice(0, VISIBLE_CATEGORIES)"
          :key="category.id"
          variant="outline"
        >
          {{ category.name }}
        </Badge>
        <Badge v-if="hiddenCategories > 0" variant="outline">
          {{
            t("panel.sources.indexers.moreCategories", { n: hiddenCategories })
          }}
        </Badge>
      </div>
      <p v-if="indexer.checkedAt" class="text-xs text-muted-foreground">
        {{
          t("panel.sources.indexers.checkedAt", {
            time: formatDateTime(indexer.checkedAt, locale),
          })
        }}
      </p>
    </div>

    <div class="flex items-center gap-2">
      <Switch
        :model-value="indexer.enabled"
        :disabled="isToggling"
        :aria-label="t('panel.sources.indexers.enable', { name: indexer.name })"
        @update:model-value="onToggle"
      />
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="isTesting"
        @click="onTest"
      >
        {{ t("panel.sources.indexers.test") }}
      </LoadingButton>
      <AlertDialog>
        <AlertDialogTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.common.delete')"
          >
            <Trash2Icon />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{
                t("panel.sources.indexers.deleteTitle", { name: indexer.name })
              }}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {{
                indexer.managerId && !indexer.missing
                  ? t("panel.sources.indexers.deleteManagedText", {
                    manager: managerName,
                  })
                  : t("panel.sources.indexers.deleteText")
              }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {{ t("panel.common.cancel") }}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" @click="onDelete">
              {{ t("panel.common.delete") }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </li>
</template>
