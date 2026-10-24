<script setup lang="ts">
import type { BackupItem, BackupStatus } from '@torsher/api-client'
import type { BackupProblem } from '~/lib/backups'
import type { RestoreOutcome } from '~/composables/useRestoreFlow'
import {
  ArchiveIcon,
  CircleAlertIcon,
  Loader2Icon,
  UploadIcon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import { BackupRequestError } from '~/composables/useBackups'
import { backupErrorText, formatWhen } from '~/lib/backups'
import BackupDeleteDialog from './BackupDeleteDialog.vue'
import BackupRestoreDialog from './BackupRestoreDialog.vue'
import BackupRow from './BackupRow.vue'

const props = defineProps<{
  status: BackupStatus
}>()

const emit = defineEmits<{
  restored: [outcome: Extract<RestoreOutcome, { kind: 'finished' }>]
}>()

const { t, locale } = useI18n()
const { backupNow, upload } = useBackups()
const now = useNow({ interval: 30_000 })

const base = 'panel.backups.list'

const starting = ref(false)
const uploading = ref(false)
const uploadError = ref<BackupProblem | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const selected = ref<BackupItem | null>(null)
const restoreOpen = ref(false)
const deleteOpen = ref(false)

const running = computed(() => props.status.state.running)
const items = computed(() => props.status.items)
const busy = computed(() => starting.value || !!running.value)

const emptyText = computed(() => {
  const { settings, state } = props.status

  if (!settings.enabled || !state.nextAt)
    return t(`${base}.emptyOff`)

  return t(`${base}.emptyText`, {
    when: formatWhen(t, state.nextAt, locale.value, {
      timeZone: state.timezone,
      now: now.value,
    }),
  })
})

// Итог ручной копии — тостом, когда опрос увидел конец снимка
watch(running, (current, previous) => {
  if (!previous || current || previous.reason !== 'manual')
    return

  const manual = props.status.state.manual

  if (manual?.error && manual.at >= previous.startedAt) {
    toast.error(t(`${base}.createFailed`), {
      description: backupErrorText(t, locale.value, manual.error),
    })
  }
  else {
    toast.success(t(`${base}.created`))
  }
})

async function create() {
  starting.value = true
  uploadError.value = null

  try {
    await backupNow()
  }
  finally {
    starting.value = false
  }
}

function chooseFile() {
  uploadError.value = null
  fileInput.value?.click()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  // Тот же файл можно выбрать снова после ошибки
  input.value = ''

  if (!file)
    return

  uploading.value = true

  try {
    await upload(file)
    toast.success(t(`${base}.uploaded`), { description: file.name })
  }
  catch (err) {
    uploadError.value
      = err instanceof BackupRequestError ? err.problem : { kind: 'unknown' }
  }
  finally {
    uploading.value = false
  }
}

function restore(item: BackupItem) {
  selected.value = item
  restoreOpen.value = true
}

function remove(item: BackupItem) {
  selected.value = item
  deleteOpen.value = true
}
</script>

<template>
  <Card class="gap-0 overflow-hidden py-0">
    <div class="flex flex-wrap items-start justify-between gap-3 p-5">
      <div class="grid gap-1">
        <CardTitle class="text-base font-semibold tracking-tight">
          {{ t(`${base}.title`) }}
        </CardTitle>
        <CardDescription class="max-w-[62ch]">
          {{ t(`${base}.text`) }}
        </CardDescription>
      </div>
      <div class="flex flex-wrap gap-2">
        <LoadingButton
          variant="outline"
          size="sm"
          :loading="uploading"
          :disabled="busy"
          @click="chooseFile"
        >
          <UploadIcon aria-hidden="true" />
          {{ t(`${base}.upload`) }}
        </LoadingButton>
        <!-- Без копий кнопка — в пустом состоянии: одна на поверхность. Высоту
             шапки держит «Загрузить копию…» -->
        <LoadingButton
          v-if="items.length || running"
          size="sm"
          :loading="busy"
          :disabled="uploading"
          @click="create"
        >
          {{ t(`${base}.create`) }}
        </LoadingButton>
        <input
          ref="fileInput"
          type="file"
          accept=".gz,.enc"
          class="hidden"
          @change="onFile"
        >
      </div>
    </div>

    <div v-if="uploadError" class="border-t px-5 py-3">
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{{ t(`${base}.uploadFailed`) }}</AlertTitle>
        <AlertDescription>
          {{ backupErrorText(t, locale, uploadError) }}
        </AlertDescription>
      </Alert>
    </div>

    <ul v-if="items.length || running" class="border-t">
      <!-- Строка идущего снимка той же высоты, что и готовая копия -->
      <li
        v-if="running"
        class="grid min-h-11 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 border-b bg-info/5 py-2 pr-2.5 pl-4 text-[13.5px] last:border-b-0 sm:py-1.5"
        role="status"
      >
        <Loader2Icon class="size-4 animate-spin text-info" aria-hidden="true" />
        <span class="flex min-w-0 items-center gap-2">
          <span class="font-medium">{{ t(`${base}.running`) }}</span>
          <Skeleton class="h-4 w-24 rounded" />
        </span>
        <Skeleton class="mr-9 h-4 w-12 rounded" />
      </li>
      <BackupRow
        v-for="item in items"
        :key="item.name"
        :item="item"
        :now="now"
        @restore="restore(item)"
        @remove="remove(item)"
      />
    </ul>

    <div
      v-else
      class="grid justify-items-center gap-3 border-t px-4 py-10 text-center"
    >
      <div
        class="grid size-11 place-items-center rounded-xl border bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <ArchiveIcon class="size-5" />
      </div>
      <h3 class="text-base font-semibold">
        {{ t(`${base}.empty`) }}
      </h3>
      <p class="max-w-[46ch] text-muted-foreground">
        {{ emptyText }}
      </p>
      <LoadingButton :loading="busy" :disabled="uploading" @click="create">
        {{ t(`${base}.create`) }}
      </LoadingButton>
    </div>

    <BackupRestoreDialog
      v-model:open="restoreOpen"
      :item="selected"
      @finished="emit('restored', $event)"
    />
    <BackupDeleteDialog v-model:open="deleteOpen" :item="selected" />
  </Card>
</template>
