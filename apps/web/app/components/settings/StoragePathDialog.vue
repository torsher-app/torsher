<script setup lang="ts">
import type { StorageOverview, StoragePathCheck } from '@torsher/api-client'
import type { StorageKind, StoragePathError } from '~/composables/useStorage'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import FolderPicker from '~/components/storage/FolderPicker.vue'
import { storagePathError } from '~/composables/useStorage'
import { dialogSheetClass } from '~/lib/dialog'
import { formatBytes } from '~/lib/format'

const props = defineProps<{
  kind: StorageKind
  overview: StorageOverview
}>()

const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const { checkPath, changePath } = useStorage()

const CHECK_DELAY_MS = 250

const folder = computed(() => props.overview.folders[props.kind])
const titleKey = computed(() =>
  props.kind === 'downloads' ? 'Downloads' : 'Library',
)
const base = 'panel.settings.storage.pathDialog'

const schema = toTypedSchema(
  z.object({
    path: z.string().trim().min(1),
    mode: z.enum(['new_only', 'move']),
  }),
)

const { handleSubmit, defineField, isSubmitting, resetForm } = useForm({
  validationSchema: schema,
  initialValues: { path: '', mode: 'new_only' as 'new_only' | 'move' },
})

const [path] = defineField('path')
const [mode] = defineField('mode')

const check = shallowRef<StoragePathCheck | null>(null)
const checking = ref(false)
// Скелетон — только под первую проверку: дальше прошлые строки остаются приглушёнными
const checkLoading = useHeldLoading(() => checking.value && !check.value)
const serverError = ref<StoragePathError | null>(null)
let checkSeq = 0

const bytes = (value: number) => formatBytes(value, locale.value)

function normalized(value: string | undefined) {
  const trimmed = value?.trim() ?? ''

  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
}

const isCurrent = computed(() => normalized(path.value) === folder.value.path)
const hasData = computed(() => folder.value.items > 0)
const checkedHere = computed(
  () => !!check.value && check.value.path === normalized(path.value),
)
const notEnoughSpace = computed(
  () => !!check.value && check.value.moveBytes > check.value.free,
)
const choosing = computed(
  () => hasData.value && !isCurrent.value && !check.value?.problem,
)
const moving = computed(() => choosing.value && mode.value === 'move')

// Загрузки уезжают с тома библиотеки: хардлинки «Оставить» станут копиями
const separates = computed(
  () =>
    props.kind === 'downloads'
    && moving.value
    && check.value?.linkMode === 'copy'
    && props.overview.library.linkMode !== 'copy',
)

const canSubmit = computed(
  () =>
    checkedHere.value
    && !checking.value
    && !check.value?.problem
    && !isCurrent.value
    && !(moving.value && notEnoughSpace.value),
)

async function runCheck(value: string) {
  const seq = ++checkSeq

  if (!value.startsWith('/')) {
    check.value = null
    checking.value = false
    return
  }

  checking.value = true

  try {
    const result = await checkPath(props.kind, value)

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

    resetForm({ values: { path: folder.value.path, mode: 'new_only' } })
    check.value = null
    serverError.value = null
    void runCheck(folder.value.path)
  },
  { immediate: true },
)

// Перенос недоступен — выбор сам уходит на «Только новые»
watch(notEnoughSpace, (value) => {
  if (value && mode.value === 'move')
    mode.value = 'new_only'
})

interface CheckRow {
  id: string
  tone: 'ok' | 'info' | 'warning' | 'error'
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

  const rows: CheckRow[] = [
    {
      id: 'write',
      tone: value.exists ? 'ok' : 'info',
      text: t(
        `${base}.${!value.exists ? 'created' : isCurrent.value ? 'current' : 'writable'}`,
      ),
    },
    {
      id: 'space',
      tone: moving.value && notEnoughSpace.value ? 'warning' : 'ok',
      text:
        moving.value && notEnoughSpace.value
          ? t(`${base}.moveNoSpace`, {
              needed: bytes(value.moveBytes),
              free: bytes(value.free),
            })
          : t(`${base}.space`, {
              free: bytes(value.free),
              total: bytes(value.total),
            }),
    },
  ]

  if (value.linkMode) {
    rows.push({
      id: 'links',
      tone:
        value.linkMode === 'copy'
          ? 'warning'
          : value.linkMode === 'reflink'
            ? 'info'
            : 'ok',
      text: t(`${base}.links.${value.linkMode}`),
    })
  }

  return rows
})

const TONE_ICON = {
  ok: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: CircleXIcon,
} as const

const TONE_CLASS = {
  ok: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  error: 'text-destructive',
} as const

const options = computed(() => [
  {
    value: 'new_only' as const,
    title: t(`${base}.newOnlyTitle`),
    text: t(`${base}.newOnly${titleKey.value}`),
    disabled: false,
  },
  {
    value: 'move' as const,
    title: t(`${base}.moveTitle`, { size: bytes(folder.value.bytes) }),
    text: check.value?.sameVolume
      ? t(`${base}.moveSameVolume`)
      : t(`${base}.move${titleKey.value}`),
    disabled: notEnoughSpace.value,
  },
])

function resetToDefault() {
  path.value = folder.value.envPath
}

const onSubmit = handleSubmit(async (values) => {
  if (!canSubmit.value)
    return

  serverError.value = null

  const target = normalized(values.path)
  const move = choosing.value && values.mode === 'move'

  try {
    await changePath({
      kind: props.kind,
      path: target === folder.value.envPath ? null : target,
      mode: move ? 'move' : 'new_only',
    })
    open.value = false

    if (move) {
      toast.success(t(`${base}.moveStarted`), {
        description: t(`${base}.moveStartedText`),
      })
    }
    else {
      toast.success(t(`${base}.saved${titleKey.value}`), {
        description: target,
      })
    }
  }
  catch (err) {
    serverError.value = await storagePathError(err)
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t(`${base}.title${titleKey}`) }}</DialogTitle>
        <DialogDescription>
          {{ t(`${base}.text${titleKey}`) }}
        </DialogDescription>
      </DialogHeader>

      <form
        id="storage-path"
        class="grid min-w-0 gap-4"
        novalidate
        @submit="onSubmit"
      >
        <Alert v-if="serverError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t(`${base}.errorTitle`) }}</AlertTitle>
          <AlertDescription>
            {{
              ["busy", "no_space", "unknown"].includes(serverError)
                ? t(`${base}.errors.${serverError}`)
                : t(`${base}.problems.${serverError}`)
            }}
          </AlertDescription>
        </Alert>

        <div class="grid min-w-0 gap-2">
          <Label for="storage-path-input">{{ t(`${base}.path`) }}</Label>
          <FolderPicker
            id="storage-path-input"
            v-model="path"
            follow
            :placeholder="folder.envPath"
            :invalid="!!check?.problem"
            describedby="storage-path-hint"
          />
          <p id="storage-path-hint" class="text-[12.5px] text-muted-foreground">
            {{ t(`${base}.pathHint`) }}
          </p>
        </div>

        <!-- Проверка постоянной высоты: строки не прыгают при переходах -->
        <ul
          class="grid min-h-[5.5rem] content-start gap-1.5 rounded-lg border bg-muted/40 p-3 text-[13px] leading-5 transition-opacity"
          :class="{ 'opacity-60': checking && check }"
          :aria-busy="checking"
          aria-live="polite"
        >
          <template v-if="check && !checkLoading">
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
          <template v-else-if="checkLoading">
            <li class="sr-only">
              {{ t(`${base}.checking`) }}
            </li>
            <Skeleton v-for="item in 3" :key="item" class="h-5 rounded" />
          </template>
          <li v-else class="text-muted-foreground">
            {{ t(`${base}.problems.not_absolute`) }}
          </li>
        </ul>

        <RadioGroup
          v-if="choosing"
          v-model="mode"
          class="gap-2"
          :aria-label="t(`${base}.mode`)"
        >
          <Label
            v-for="option in options"
            :key="option.value"
            :for="`storage-mode-${option.value}`"
            class="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            <RadioGroupItem
              :id="`storage-mode-${option.value}`"
              :value="option.value"
              :disabled="option.disabled"
              class="mt-0.5"
            />
            <span class="grid gap-0.5">
              <span class="font-medium tabular-nums">{{ option.title }}</span>
              <span class="text-[12.5px] text-muted-foreground">
                {{ option.text }}
              </span>
            </span>
          </Label>
        </RadioGroup>

        <Alert v-if="separates" variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>{{ t(`${base}.separates`) }}</AlertDescription>
        </Alert>
      </form>

      <DialogFooter class="sm:justify-between">
        <Button
          v-if="folder.source === 'panel'"
          variant="ghost"
          :disabled="isSubmitting || normalized(path) === folder.envPath"
          @click="resetToDefault"
        >
          {{ t(`${base}.reset`) }}
        </Button>
        <span v-else class="max-sm:hidden" />
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            variant="outline"
            :disabled="isSubmitting"
            @click="open = false"
          >
            {{ t("panel.common.cancel") }}
          </Button>
          <LoadingButton
            type="submit"
            form="storage-path"
            :loading="isSubmitting"
            :disabled="!canSubmit"
          >
            {{ moving ? t(`${base}.startMove`) : t(`${base}.save`) }}
          </LoadingButton>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
