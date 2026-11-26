<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import LoadingButton from '~/components/LoadingButton.vue'
import { api } from '~/services/api'

export interface UsenetNetworkApproval {
  origin: string
  lanAddresses: string[]
}

const props = defineProps<{
  url?: string
  disabled?: boolean
  httpsOnly?: boolean
}>()
const emit = defineEmits<{ approve: [approval: UsenetNetworkApproval] }>()
const { t } = useI18n()
const preview = shallowRef<UsenetNetworkApproval>()
const checking = ref(false)
const problem = ref(false)
let revision = 0

watch(
  () => props.url,
  () => {
    revision++
    preview.value = undefined
    checking.value = false
    problem.value = false
  },
)

async function check() {
  const url = props.url?.trim()
  if (!url || checking.value)
    return
  const current = ++revision
  checking.value = true
  problem.value = false
  preview.value = undefined
  try {
    const parsed = new URL(url)
    if (
      props.httpsOnly
      && (parsed.href !== `${parsed.origin}/` || parsed.protocol !== 'https:')
    ) {
      throw new Error('Expected HTTPS origin')
    }
    const item = await withErrorMode('silent', () =>
      api.usenet.postUsenetAddress({ url }))
    if (current === revision)
      preview.value = item
  }
  catch {
    if (current === revision)
      problem.value = true
  }
  finally {
    if (current === revision)
      checking.value = false
  }
}

function approve() {
  const item = preview.value
  if (!item)
    return
  preview.value = undefined
  emit('approve', item)
}
</script>

<template>
  <div class="grid gap-2">
    <LoadingButton
      type="button"
      variant="outline"
      size="sm"
      class="justify-self-start"
      :loading="checking"
      :disabled="!url?.trim() || disabled"
      @click="check"
    >
      {{ t("panel.settings.network.hosts.check") }}
    </LoadingButton>
    <div v-if="preview" class="grid gap-2 rounded-md border p-3">
      <p class="font-mono text-xs break-all">
        {{ [preview.origin, ...preview.lanAddresses].join(" · ") }}
      </p>
      <Button
        type="button"
        size="sm"
        class="justify-self-start"
        :disabled="disabled"
        @click="approve"
      >
        {{ t("usenet.confirmAddress") }}
      </Button>
    </div>
    <p v-if="problem" class="text-sm text-destructive" role="alert">
      {{ t("usenet.checkFailed") }}
    </p>
  </div>
</template>
