<script setup lang="ts">
import type { Indexer } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
  status: Indexer['checkStatus']
}>()

const { t } = useI18n()

const variant = computed(() => {
  if (props.status === null)
    return 'outline'

  return props.status === 'ok' ? 'secondary' : 'destructive'
})
</script>

<template>
  <Badge :variant="variant">
    {{ t(`panel.sources.status.${status ?? "pending"}`) }}
  </Badge>
</template>
