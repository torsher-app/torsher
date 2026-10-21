<script setup lang="ts">
import type { NetHost } from '@torsher/api-client'
import { Loader2Icon, RefreshCwIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import LoadingButton from '~/components/LoadingButton.vue'
import { hostNeedsAttention } from '~/lib/netStatus'
import NetworkHostRow from './NetworkHostRow.vue'

const emit = defineEmits<{
  route: [host: NetHost]
}>()

const { t } = useI18n()
const network = useNetwork()

const check = computed(() => network.check.value)
const isStarting = ref(false)

// Полоса — только у проверки всех хостов; один хост виден спиннером в строке
const run = computed(() =>
  check.value?.running
    ? { done: check.value.done, total: check.value.total }
    : null,
)
const percent = computed(() =>
  run.value?.total ? Math.round((run.value.done / run.value.total) * 100) : 0,
)
const progressTitle = computed(() =>
  run.value ? t('panel.settings.network.check.title', run.value) : '',
)

function proxyOf(host: NetHost) {
  return (
    network.routes.value.find(item => item.id === host.route.id)?.proxy
    ?? null
  )
}

async function checkAll() {
  isStarting.value = true

  let started

  try {
    // Ошибку запуска показывает тостом API-клиент
    started = await network.checkAll()
  }
  catch {
    return
  }
  finally {
    isStarting.value = false
  }

  const result = await started.done

  if (!result)
    return

  const problems = result.hosts.filter(hostNeedsAttention).length

  if (problems) {
    toast.warning(
      t('panel.settings.network.check.doneProblems', { n: problems }),
    )
  }
  else {
    toast.success(
      t('panel.settings.network.check.doneOk', { n: result.hosts.length }),
    )
  }
}
</script>

<template>
  <Card class="gap-0 overflow-hidden py-0">
    <div class="flex flex-wrap items-start justify-between gap-3 p-5">
      <div class="grid gap-1">
        <CardTitle class="text-base font-semibold tracking-tight">
          {{ t("panel.settings.network.hosts.title") }}
        </CardTitle>
        <CardDescription class="max-w-[62ch]">
          {{ t("panel.settings.network.hosts.text") }}
        </CardDescription>
      </div>
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="isStarting"
        :disabled="network.isChecking.value"
        @click="checkAll"
      >
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.settings.network.hosts.checkAll") }}
      </LoadingButton>
    </div>

    <div
      v-if="run"
      class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t bg-info/10 px-4 py-2 text-[13px]"
      role="status"
    >
      <Loader2Icon class="size-4 animate-spin text-info" aria-hidden="true" />
      <span>
        <span class="font-medium tabular-nums">{{ progressTitle }}</span>
        <span class="text-muted-foreground">
          · {{ t("panel.settings.network.check.hint") }}</span>
      </span>
      <Progress
        :model-value="percent"
        class="ml-auto h-1 w-40 bg-accent *:data-[slot=progress-indicator]:bg-brand"
        :aria-label="progressTitle"
      />
    </div>

    <ul class="border-t">
      <NetworkHostRow
        v-for="host in check?.hosts ?? []"
        :key="host.id"
        :host="host"
        :proxy="proxyOf(host)"
        @check="network.checkHost(host.id)"
        @route="emit('route', host)"
      />
    </ul>
  </Card>
</template>
