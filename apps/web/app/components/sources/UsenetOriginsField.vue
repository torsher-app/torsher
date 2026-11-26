<script setup lang="ts">
import type { UsenetNetworkApproval } from './UsenetAddressApproval.vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import UsenetAddressApproval from './UsenetAddressApproval.vue'

defineProps<{ disabled?: boolean }>()
const origins = defineModel<UsenetNetworkApproval[]>({ required: true })
const { t } = useI18n()
const url = ref('')

function approve(item: UsenetNetworkApproval) {
  origins.value = [
    ...origins.value.filter(current => current.origin !== item.origin),
    item,
  ]
  url.value = ''
}
</script>

<template>
  <div class="grid gap-2">
    <Label for="usenet-download-origin">{{
      t("usenet.downloadOrigins")
    }}</Label>
    <ul v-if="origins.length" class="grid gap-1">
      <li
        v-for="origin in origins"
        :key="origin.origin"
        class="flex items-center justify-between gap-2"
      >
        <span class="min-w-0 font-mono text-xs break-all">{{
          origin.origin
        }}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="
            origins = origins.filter((item) => item.origin !== origin.origin)
          "
        >
          {{ t("panel.common.delete") }}
        </Button>
      </li>
    </ul>
    <template v-if="origins.length < 8">
      <Input
        id="usenet-download-origin"
        v-model="url"
        type="url"
        autocomplete="off"
        placeholder="https://indexer.example"
        :disabled="disabled"
      />
      <UsenetAddressApproval
        :url="url"
        :disabled="disabled"
        https-only
        @approve="approve"
      />
    </template>
  </div>
</template>
