<script setup lang="ts">
import type { CheckRun } from '~/composables/useSources'
import { Loader2Icon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Progress } from '@/components/ui/progress'

const props = defineProps<{
  run: CheckRun
}>()

const { t } = useI18n()

const title = computed(() =>
  t('panel.sources.progress.title', {
    done: props.run.done,
    total: props.run.total,
  }),
)
const percent = computed(() =>
  props.run.total ? Math.round((props.run.done / props.run.total) * 100) : 0,
)
</script>

<template>
  <div
    class="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b bg-info/10 px-4 py-2 text-[13px]"
    role="status"
  >
    <Loader2Icon class="size-4 animate-spin text-info" aria-hidden="true" />
    <span>
      <span class="font-medium tabular-nums">{{ title }}</span>
      <span class="text-muted-foreground">
        · {{ t("panel.sources.progress.hint") }}</span>
    </span>
    <Progress
      :model-value="percent"
      class="ml-auto h-1 w-40 bg-accent *:data-[slot=progress-indicator]:bg-brand"
      :aria-label="title"
    />
  </div>
</template>
