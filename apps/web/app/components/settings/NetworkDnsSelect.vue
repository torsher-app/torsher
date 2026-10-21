<script setup lang="ts">
import type { NetRoute } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

defineProps<{
  id: string
}>()

const value = defineModel<NetRoute['dns'] | undefined>()

const { t } = useI18n()
const { providers } = useNetwork()

// Порядок провайдеров — с сервера: список DoH живёт там
const options = computed<NetRoute['dns'][]>(() => [
  'system',
  ...providers.value.map(item => item.id),
  'custom',
])
</script>

<template>
  <Select v-model="value">
    <SelectTrigger :id="id" class="w-full sm:w-64">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="option in options" :key="option" :value="option">
        {{ t(`panel.settings.network.dns.${option}`) }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
