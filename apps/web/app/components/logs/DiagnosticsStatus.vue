<script setup lang="ts">
import type { DiagnosticStatus, LogEntry } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import LoadingButton from '~/components/LoadingButton.vue'

const props = defineProps<{
  status?: DiagnosticStatus
  entries: LogEntry[]
  failed: boolean
  loading: boolean
}>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const losses = computed(() => {
  const seen = new Set<string>()
  return props.entries.reduce((total, entry) => {
    const context = entry.context
    if (
      context?.event !== 'diagnostics.loss'
      || typeof context.count !== 'number'
    ) {
      return total
    }
    const id = String(context.eventId ?? entry.id)
    if (seen.has(id))
      return total
    seen.add(id)
    return total + context.count
  }, 0)
})
const warning = computed(() =>
  props.failed
    ? 'unknown'
    : props.status?.enabled && !props.status.collecting
      ? 'filtered'
      : undefined,
)
const degraded = computed(
  () =>
    props.status?.fileSinkState === 'disabled'
    || props.status?.retentionState === 'degraded',
)
</script>

<template>
  <div
    v-if="warning || degraded || losses"
    class="grid gap-1 border-b px-4 py-2 text-xs text-muted-foreground"
    role="status"
  >
    <div v-if="warning" class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p>{{ t(`panel.logs.diagnostics.${warning}`) }}</p>
      <LoadingButton
        v-if="failed"
        variant="outline"
        size="xs"
        :loading="loading"
        @click="emit('retry')"
      >
        {{ t("state.retry") }}
      </LoadingButton>
    </div>
    <p v-if="degraded">
      {{ t("panel.logs.diagnostics.degraded") }}
    </p>
    <p v-if="losses">
      {{ t("panel.logs.diagnostics.losses", { count: losses }) }}
    </p>
  </div>
</template>
