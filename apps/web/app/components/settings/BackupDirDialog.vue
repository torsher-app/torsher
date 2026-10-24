<script setup lang="ts">
import type { BackupDirCheck, BackupStatus } from '@torsher/api-client'
import type { BackupRequestError } from '~/composables/useBackups'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  TriangleAlertIcon,
} from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useDebounceFn } from '@vueuse/core'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import FolderPicker from '~/components/storage/FolderPicker.vue'
import { backupErrorText } from '~/lib/backups'
import { dialogSheetClass } from '~/lib/dialog'
import { formatBytes } from '~/lib/format'

const props = defineProps<{
  status: BackupStatus
}>()

const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const { checkDir, saveSettings } = useBackups()

const CHECK_DELAY_MS = 250
const base = 'panel.backups.dir.dialog'

const schema = toTypedSchema(z.object({ path: z.string().trim().min(1) }))

const { handleSubmit, defineField, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { path: '' },
})

const [path] = defineField('path')

const check = shallowRef<BackupDirCheck | null>(null)
const checking = ref(false)
const resetting = ref(false)
const serverError = ref<BackupRequestError['problem'] | null>(null)
let checkSeq = 0

function normalized(value: string | undefined) {
  const trimmed = value?.trim() ?? ''

  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
}

const isCurrent = computed(
  () => normalized(path.value) === props.status.dir.path,
)
const checkedHere = computed(
  () => !!check.value && check.value.path === normalized(path.value),
)
const canSubmit = computed(
  () =>
    checkedHere.value
    && !checking.value
    && !check.value?.problem
    && !isCurrent.value,
)
const busy = computed(() => isSubmitting.value || resetting.value)

async function runCheck(value: string) {
  const seq = ++checkSeq

  if (!value.startsWith('/')) {
    check.value = null
    checking.value = false
    return
  }

  checking.value = true

  try {
    const result = await checkDir(value)

    if (seq === checkSeq)
      check.value = result
  }
  catch {
    if (seq === checkSeq)
      check.value = null
  }
  finally {
    if (seq === checkSeq)
      checking.value = false
  }
}

const scheduleCheck = useDebounceFn(runCheck, CHECK_DELAY_MS)

watch(path, (value) => {
  serverError.value = null
  checking.value = true
  void scheduleCheck(normalized(value))
})

watch(
  open,
  (isOpen) => {
    if (!isOpen)
      return

    resetForm({ values: { path: props.status.dir.path } })
    check.value = null
    serverError.value = null
    void runCheck(props.status.dir.path)
  },
  { immediate: true },
)

interface CheckRow {
  id: string
  tone: 'ok' | 'warning' | 'error'
  text: string
}

const checkRows = computed<CheckRow[]>(() => {
  const value = check.value

  if (!value)
    return []

  if (value.problem) {
    return [
      {
        id: 'write',
        tone: 'error',
        text: t(`${base}.problems.${value.problem}`),
      },
    ]
  }

  return [
    {
      id: 'write',
      tone: 'ok',
      text: t(`${base}.${isCurrent.value ? 'current' : 'writable'}`),
    },
    {
      id: 'space',
      tone: 'ok',
      text: t(`${base}.space`, {
        free: formatBytes(value.free, locale.value),
        total: formatBytes(value.total, locale.value),
      }),
    },
    {
      id: 'volume',
      tone: value.sameVolumeAsDatabase ? 'warning' : 'ok',
      text: t(
        `${base}.${value.sameVolumeAsDatabase ? 'sameVolume' : 'otherVolume'}`,
      ),
    },
  ]
})

const TONE_ICON = {
  ok: CircleCheckIcon,
  warning: TriangleAlertIcon,
  error: CircleXIcon,
} as const

const TONE_CLASS = {
  ok: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive',
} as const

function errorText(problem: BackupRequestError['problem']) {
  const key = `${base}.problems.${problem.kind}`
  const text = t(key)

  return text === key ? backupErrorText(t, locale.value, problem) : text
}

async function save(dir: string | null) {
  serverError.value = null

  try {
    await saveSettings({ dir })
    open.value = false
    toast.success(t(`${base}.${dir ? 'saved' : 'savedDefault'}`), {
      description: dir ?? undefined,
    })
  }
  catch (err) {
    serverError.value = (err as BackupRequestError).problem ?? {
      kind: 'unknown',
    }
  }
}

const onSubmit = handleSubmit(async (values) => {
  if (canSubmit.value)
    await save(normalized(values.path))
})

async function resetToDefault() {
  resetting.value = true

  try {
    await save(null)
  }
  finally {
    resetting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t(`${base}.title`) }}</DialogTitle>
        <DialogDescription>{{ t(`${base}.text`) }}</DialogDescription>
      </DialogHeader>

      <form
        id="backup-dir"
        class="grid min-w-0 gap-4"
        novalidate
        @submit="onSubmit"
      >
        <Alert v-if="serverError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t(`${base}.errorTitle`) }}</AlertTitle>
          <AlertDescription>{{ errorText(serverError) }}</AlertDescription>
        </Alert>

        <div class="grid min-w-0 gap-2">
          <Label for="backup-dir-input">{{ t(`${base}.path`) }}</Label>
          <FolderPicker
            id="backup-dir-input"
            v-model="path"
            follow
            placeholder="/mnt/backups"
            :invalid="!!check?.problem"
            describedby="backup-dir-hint"
          />
          <p id="backup-dir-hint" class="text-[12.5px] text-muted-foreground">
            {{ t(`${base}.pathHint`) }}
          </p>
        </div>

        <!-- Проверка постоянной высоты: строки не прыгают при переходах -->
        <ul
          class="grid min-h-[5.5rem] content-start gap-1.5 rounded-lg border bg-muted/40 p-3 text-[13px] leading-5 transition-opacity"
          :aria-busy="checking"
          aria-live="polite"
        >
          <!-- Только проверка этого пути: строки прошлой папки ввели бы в заблуждение -->
          <template v-if="check && checkedHere && !checking">
            <li
              v-for="row in checkRows"
              :key="row.id"
              class="flex items-start gap-2"
            >
              <component
                :is="TONE_ICON[row.tone]"
                class="mt-0.5 size-4 shrink-0"
                :class="TONE_CLASS[row.tone]"
                aria-hidden="true"
              />
              <span class="min-w-0">{{ row.text }}</span>
            </li>
          </template>
          <template v-else-if="checking || check">
            <li class="sr-only">
              {{ t(`${base}.checking`) }}
            </li>
            <Skeleton v-for="item in 3" :key="item" class="h-5 rounded" />
          </template>
          <li v-else class="text-muted-foreground">
            {{ t(`${base}.problems.not_absolute`) }}
          </li>
        </ul>
      </form>

      <DialogFooter class="sm:justify-between">
        <LoadingButton
          v-if="status.dir.source === 'panel'"
          variant="ghost"
          :loading="resetting"
          :disabled="isSubmitting"
          @click="resetToDefault"
        >
          {{ t(`${base}.reset`) }}
        </LoadingButton>
        <span v-else class="max-sm:hidden" />
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" :disabled="busy" @click="open = false">
            {{ t("panel.common.cancel") }}
          </Button>
          <LoadingButton
            type="submit"
            form="backup-dir"
            :loading="isSubmitting"
            :disabled="!canSubmit || resetting"
          >
            {{ t(`${base}.save`) }}
          </LoadingButton>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
