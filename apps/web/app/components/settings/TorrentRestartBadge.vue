<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'

const { t } = useI18n()
</script>

<template>
  <Badge variant="outline">
    {{ t("panel.settings.torrent.restartBadge") }}
  </Badge>
</template>
