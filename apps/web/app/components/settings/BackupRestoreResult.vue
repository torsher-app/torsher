<script setup lang="ts">
import type { RestoreStatus } from '@torsher/api-client'
import { CircleAlertIcon, CircleCheckIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import LoadingButton from '~/components/LoadingButton.vue'
import {
  backupErrorText,
  formatDayTime,
  restoreWarningText,
} from '~/lib/backups'

const props = defineProps<{
  restore: RestoreStatus
}>()

const { t, locale } = useI18n()
const { dismissRestore } = useBackups()

const base = 'panel.backups.result'
const closing = ref(false)

const failed = computed(() => props.restore.state === 'failed')

/** Дата копии — из её имени: время в нём UTC, `20261024T040000Z` */
const backupDate = computed(() => {
  const match = /-(\d{8}T\d{6}Z)-/.exec(props.restore.backup ?? '')
  const stamp = match?.[1]

  if (!stamp)
    return null

  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`

  return formatDayTime(iso, locale.value)
})

const title = computed(() => {
  if (failed.value)
    return t(`${base}.failed`)

  return backupDate.value
    ? t(`${base}.done`, { date: backupDate.value })
    : t(`${base}.doneShort`)
})

const lines = computed(() => {
  if (failed.value) {
    return [
      t(`${base}.failedText`, {
        reason: backupErrorText(t, locale.value, {
          kind: props.restore.reason ?? 'unknown',
          params: props.restore.params,
        }),
      }),
    ]
  }

  return props.restore.warnings
    .map(warning => restoreWarningText(t, warning))
    .filter((line): line is string => !!line)
})

async function close() {
  closing.value = true

  try {
    await dismissRestore()
  }
  finally {
    closing.value = false
  }
}
</script>

<template>
  <!-- «Закрыть» — действие Alert справа, на линии заголовка -->
  <Alert
    :variant="failed ? 'destructive' : 'default'"
    class="has-data-[slot=alert-action]:pr-28"
    role="status"
  >
    <CircleAlertIcon v-if="failed" />
    <CircleCheckIcon v-else class="text-success!" />
    <AlertTitle>{{ title }}</AlertTitle>
    <AlertDescription v-if="lines.length">
      <ul class="grid gap-1">
        <li v-for="line in lines" :key="line">
          {{ line }}
        </li>
      </ul>
    </AlertDescription>
    <AlertAction class="top-2">
      <LoadingButton
        variant="ghost"
        size="sm"
        :loading="closing"
        @click="close"
      >
        {{ t("panel.common.close") }}
      </LoadingButton>
    </AlertAction>
  </Alert>
</template>
