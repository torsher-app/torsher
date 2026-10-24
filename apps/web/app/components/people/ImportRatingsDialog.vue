<script setup lang="ts">
import type { AppliedImport, ImportJob } from '@torsher/api-client'
import { CircleAlertIcon, FileUpIcon, InfoIcon, XIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
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
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import {
  applyImportJob,
  cancelImportJob,
  fetchImportJob,
  IMPORT_POLL_MS,
  ImportUploadError,
  undoImportRun,
  uploadImportFiles,
} from '~/composables/useProfileImports'
import { formatBytes } from '~/lib/format'
import { dialogSheetClass } from '~/lib/dialog'

/**
 * Импорт своих оценок и «Позже» в профиль: файлы → сопоставление с
 * каталогом → предпросмотр с выбором, что делать с расходящимися оценками →
 * итог. Закрыть можно на любом шаге: задача на сервере идёт дальше, а
 * карточка профиля откроет диалог на том же шаге.
 */
const props = defineProps<{
  profileId: string
  profileName: string
  // Незавершённая задача профиля: диалог продолжает с её шага
  job: ImportJob | null
}>()

const emit = defineEmits<{
  changed: []
  // Данные профиля поменялись: импорт применён или отменён
  applied: []
}>()

const open = defineModel<boolean>('open', { required: true })

// Как у сервера: 20 МБ файлов за раз, не больше 20 штук
const MAX_BYTES = 20 * 1024 * 1024
const MAX_FILES = 20

type Step = 'files' | 'matching' | 'failed' | 'preview' | 'result'

const { t, locale } = useI18n()

const step = ref<Step>('files')
const job = shallowRef<ImportJob | null>(null)
const result = shallowRef<AppliedImport | null>(null)
const uploadError = ref<ImportUploadError | null>(null)
const actionFailed = ref(false)
const busy = ref<'cancel' | 'undo' | null>(null)
const dragging = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let token = 0

const filesForm = useForm({
  validationSchema: computed(() =>
    toTypedSchema(
      z.object({
        files: z
          .array(z.instanceof(File))
          .min(1, t('panel.imports.validation.files'))
          .max(MAX_FILES, t('panel.imports.validation.count', { n: MAX_FILES }))
          .refine(
            files =>
              files.reduce((sum, file) => sum + file.size, 0) <= MAX_BYTES,
            t('panel.imports.validation.size'),
          ),
      }),
    ),
  ),
  initialValues: { files: [] as File[] },
})
const [filesField] = filesForm.defineField('files')
const files = computed(() => filesField.value ?? [])

const applyForm = useForm({
  validationSchema: toTypedSchema(
    z.object({ conflicts: z.enum(['keep', 'replace', 'newer']) }),
  ),
  initialValues: { conflicts: 'keep' as const },
})
const [conflicts, conflictsProps] = applyForm.defineField('conflicts')

const preview = computed(() => job.value?.preview ?? null)
const progress = computed(() => {
  const value = job.value?.progress

  return value && value.total > 0
    ? Math.round((value.done / value.total) * 100)
    : 0
})

function stopPolling() {
  token++
  clearTimeout(pollTimer)
}

function show(next: ImportJob) {
  job.value = next

  if (next.state === 'ready') {
    step.value = 'preview'
    // В экспорте Torsher даты оценок есть всегда: по умолчанию — более поздняя
    applyForm.resetForm({
      values: {
        conflicts: next.preview?.sources.includes('torsher') ? 'newer' : 'keep',
      },
    })

    // Обзор карточки приходит без предпросмотра: дочитываем его сразу
    if (!next.preview)
      poll(next.id, 0)
  }
  else if (next.state === 'failed') {
    step.value = 'failed'
  }
  else {
    step.value = 'matching'
    poll(next.id, IMPORT_POLL_MS)
  }
}

function poll(importId: string, delay: number) {
  stopPolling()

  const mine = token

  pollTimer = setTimeout(async () => {
    try {
      const next = await fetchImportJob(props.profileId, importId)

      if (mine === token && open.value)
        show(next)
    }
    catch {
      // Задача пропала (перезапуск сервера): начинаем с файлов
      if (mine === token && open.value) {
        job.value = null
        step.value = 'files'
        uploadError.value = new ImportUploadError('unknown')
        emit('changed')
      }
    }
  }, delay)
}

watch(open, (isOpen) => {
  if (!isOpen) {
    stopPolling()
    return
  }

  uploadError.value = null
  actionFailed.value = false
  busy.value = null
  result.value = null
  filesForm.resetForm()

  if (props.job) {
    show(props.job)
  }
  else {
    job.value = null
    step.value = 'files'
  }
})

onBeforeUnmount(stopPolling)

function addFiles(list: FileList | null | undefined) {
  if (!list?.length)
    return

  const known = new Set(files.value.map(file => `${file.name}:${file.size}`))
  const added = [...list].filter(
    file => !known.has(`${file.name}:${file.size}`),
  )

  filesForm.setFieldValue('files', [...files.value, ...added])
  uploadError.value = null
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement

  addFiles(input.files)
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  addFiles(event.dataTransfer?.files)
}

function removeFile(index: number) {
  filesForm.setFieldValue(
    'files',
    files.value.filter((_, item) => item !== index),
  )
}

const onUpload = filesForm.handleSubmit(async (values) => {
  uploadError.value = null

  try {
    show(await uploadImportFiles(props.profileId, values.files))
    emit('changed')
  }
  catch (err) {
    uploadError.value
      = err instanceof ImportUploadError ? err : new ImportUploadError('unknown')
  }
})

const onApply = applyForm.handleSubmit(async (values) => {
  if (!job.value)
    return

  actionFailed.value = false

  try {
    result.value = await applyImportJob(
      props.profileId,
      job.value.id,
      values.conflicts,
    )
    step.value = 'result'
    emit('changed')
    emit('applied')
  }
  catch {
    actionFailed.value = true
  }
})

async function onCancel() {
  stopPolling()

  if (!job.value) {
    open.value = false
    return
  }

  busy.value = 'cancel'

  try {
    await cancelImportJob(props.profileId, job.value.id)
  }
  catch {
    // Задачи уже нет — отменять нечего
  }
  finally {
    busy.value = null
    emit('changed')
    open.value = false
  }
}

async function onUndo() {
  if (!result.value)
    return

  busy.value = 'undo'
  actionFailed.value = false

  try {
    const undone = await undoImportRun(props.profileId, result.value.id)

    toast.success(t('panel.imports.toasts.undone'), {
      description: undone.kept
        ? t('panel.imports.toasts.undoneKept', undone.kept)
        : undefined,
    })
    emit('changed')
    emit('applied')
    open.value = false
  }
  catch {
    actionFailed.value = true
  }
  finally {
    busy.value = null
  }
}

function uploadErrorText(error: ImportUploadError) {
  return t(`panel.imports.errors.${error.kind}`, { file: error.file ?? '' })
}

const conflictOptions = computed(() => [
  { value: 'keep', disabled: false },
  { value: 'replace', disabled: false },
  // Без дат в файле «позже» не с чем сравнить
  { value: 'newer', disabled: !preview.value?.conflictsDated },
])
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.imports.dialog.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("panel.imports.dialog.description", { name: profileName }) }}
        </DialogDescription>
      </DialogHeader>

      <!-- Шаг 1: файлы -->
      <form
        v-if="step === 'files'"
        id="import-files"
        class="grid gap-4"
        novalidate
        @submit="onUpload"
      >
        <Alert v-if="uploadError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t("panel.imports.errors.title") }}</AlertTitle>
          <AlertDescription>
            {{ uploadErrorText(uploadError) }}
          </AlertDescription>
        </Alert>

        <div class="grid gap-2">
          <Label for="import-files-input" class="sr-only">
            {{ t("panel.imports.dialog.files") }}
          </Label>
          <label
            class="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            :class="{
              'border-primary bg-muted/40': dragging,
              'border-destructive': !!filesForm.errors.value.files,
            }"
            @dragenter.prevent="dragging = true"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <FileUpIcon
              class="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <span class="text-[13.5px] font-medium">
              {{ t("panel.imports.dialog.drop") }}
            </span>
            <span class="text-[12.5px] text-muted-foreground">
              {{ t("panel.imports.dialog.dropHint") }}
            </span>
            <input
              id="import-files-input"
              type="file"
              multiple
              accept=".csv,.json,.zip,.gz,text/csv,application/json,application/zip,application/gzip"
              class="sr-only"
              :aria-invalid="!!filesForm.errors.value.files || undefined"
              @change="onPick"
            >
          </label>
          <p
            v-if="filesForm.errors.value.files"
            class="text-[12.5px] text-destructive"
          >
            {{ filesForm.errors.value.files }}
          </p>
        </div>

        <ul
          v-if="files.length"
          class="max-h-[198px] divide-y overflow-y-auto rounded-lg border"
        >
          <li
            v-for="(file, index) in files"
            :key="`${file.name}:${file.size}`"
            class="flex h-11 items-center gap-2 pr-1.5 pl-3 text-[13px]"
          >
            <span class="min-w-0 flex-1 truncate font-mono text-xs">{{
              file.name
            }}</span>
            <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
              {{ formatBytes(file.size, locale) }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :aria-label="
                t('panel.imports.dialog.remove', { name: file.name })
              "
              @click="removeFile(index)"
            >
              <XIcon />
            </Button>
          </li>
        </ul>

        <div class="grid gap-1.5 text-[12.5px] text-muted-foreground">
          <p class="font-medium text-foreground">
            {{ t("panel.imports.dialog.formats") }}
          </p>
          <ul class="grid list-disc gap-1 pl-4">
            <li>{{ t("panel.imports.dialog.formatImdb") }}</li>
            <li>{{ t("panel.imports.dialog.formatLetterboxd") }}</li>
            <li>{{ t("panel.imports.dialog.formatTrakt") }}</li>
            <li>{{ t("panel.imports.dialog.formatImportCsv") }}</li>
            <li>{{ t("panel.imports.dialog.formatTorsher") }}</li>
          </ul>
        </div>
      </form>

      <!-- Шаг 2: сопоставление -->
      <div
        v-else-if="step === 'matching'"
        class="grid content-center gap-3 py-6"
        aria-live="polite"
      >
        <div class="flex items-baseline justify-between gap-3 text-[13.5px]">
          <span class="font-medium">{{
            t("panel.imports.dialog.matching")
          }}</span>
          <span class="text-muted-foreground tabular-nums">
            {{
              job?.progress.total
                ? t("panel.imports.dialog.progress", {
                  done: job.progress.done,
                  total: job.progress.total,
                })
                : ""
            }}
          </span>
        </div>
        <Progress :model-value="progress" class="bg-input" />
        <p class="text-[12.5px] text-muted-foreground">
          {{ t("panel.imports.dialog.matchingHint") }}
        </p>
      </div>

      <!-- Каталог не ответил -->
      <Alert v-else-if="step === 'failed'" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{{ t("panel.imports.dialog.failedTitle") }}</AlertTitle>
        <AlertDescription>
          {{ t("panel.imports.dialog.failedText") }}
        </AlertDescription>
      </Alert>

      <!-- Шаг 3: предпросмотр -->
      <div
        v-else-if="step === 'preview' && !preview"
        class="grid gap-2 rounded-lg border p-3"
        aria-busy="true"
      >
        <Skeleton v-for="row in 6" :key="row" class="h-4" />
      </div>
      <form
        v-else-if="step === 'preview' && preview"
        id="import-apply"
        class="grid gap-4"
        novalidate
        @submit="onApply"
      >
        <p class="text-[12.5px] text-muted-foreground">
          {{
            t("panel.imports.dialog.sources", {
              sources: preview.sources
                .map((item) => t(`panel.imports.sources.${item}`))
                .join(", "),
            })
          }}
        </p>
        <dl
          class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 rounded-lg border p-3 text-[13.5px]"
        >
          <template v-if="preview.progress">
            <dt>{{ t("panel.imports.preview.progress") }}</dt>
            <dd class="text-right tabular-nums">
              {{ preview.progress.new + preview.progress.updated }}
            </dd>
          </template>
          <dt>{{ t("panel.imports.preview.newRatings") }}</dt>
          <dd class="text-right tabular-nums">
            {{ preview.ratings.new }}
          </dd>
          <dt>{{ t("panel.imports.preview.watchlist") }}</dt>
          <dd class="text-right tabular-nums">
            {{ preview.watchlist.new }}
          </dd>
          <template v-if="preview.favorites">
            <dt>{{ t("panel.imports.preview.favorites") }}</dt>
            <dd class="text-right tabular-nums">
              {{ preview.favorites.new }}
            </dd>
          </template>
          <template v-if="preview.dropped">
            <dt>{{ t("panel.imports.preview.dropped") }}</dt>
            <dd class="text-right tabular-nums">
              {{ preview.dropped.new }}
            </dd>
          </template>
          <dt>{{ t("panel.imports.preview.same") }}</dt>
          <dd class="text-right tabular-nums">
            {{
              preview.ratings.same
                + preview.watchlist.same
                + (preview.progress?.same ?? 0)
            }}
          </dd>
          <dt>{{ t("panel.imports.preview.conflicts") }}</dt>
          <dd class="text-right tabular-nums">
            {{ preview.ratings.conflicts }}
          </dd>
          <!-- В экспорте Torsher тайтлы уже с ID: сопоставлять нечего -->
          <template v-if="!preview.progress">
            <dt class="text-muted-foreground">
              {{ t("panel.imports.preview.unmatched") }}
            </dt>
            <dd class="text-right text-muted-foreground tabular-nums">
              {{ preview.unsure + preview.notFound }}
            </dd>
          </template>
          <dt class="text-muted-foreground">
            {{
              t(
                preview.progress
                  ? "panel.imports.preview.skippedExport"
                  : "panel.imports.preview.skipped",
              )
            }}
          </dt>
          <dd class="text-right text-muted-foreground tabular-nums">
            {{ preview.skipped }}
          </dd>
        </dl>

        <fieldset v-if="preview.ratings.conflicts > 0" class="grid gap-2">
          <legend class="mb-2 text-[13.5px] font-medium">
            {{ t("panel.imports.preview.conflictsLegend") }}
          </legend>
          <ul class="grid gap-1 text-[12.5px] text-muted-foreground">
            <li
              v-for="sample in preview.conflictSamples"
              :key="sample.titleId"
              class="truncate"
            >
              {{
                t("panel.imports.preview.sample", {
                  title: sample.title,
                  current: sample.current,
                  incoming: sample.incoming,
                })
              }}
            </li>
          </ul>
          <RadioGroup v-model="conflicts" v-bind="conflictsProps" class="gap-2">
            <Label
              v-for="option in conflictOptions"
              :key="option.value"
              :for="`import-conflicts-${option.value}`"
              class="flex items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary"
              :class="
                option.disabled
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer'
              "
            >
              <RadioGroupItem
                :id="`import-conflicts-${option.value}`"
                :value="option.value"
                :disabled="option.disabled"
                class="mt-0.5"
              />
              <span class="grid gap-0.5">
                <span class="text-[13.5px] font-medium">
                  {{ t(`panel.imports.policies.${option.value}`) }}
                </span>
                <span class="text-[12.5px] text-muted-foreground">
                  {{
                    option.disabled
                      ? t("panel.imports.policies.newerNoDates")
                      : t(`panel.imports.policies.${option.value}Hint`)
                  }}
                </span>
              </span>
            </Label>
          </RadioGroup>
        </fieldset>

        <Alert v-if="actionFailed" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t("panel.imports.errors.applyFailed") }}</AlertTitle>
          <AlertDescription>
            {{ t("panel.imports.errors.applyFailedText") }}
          </AlertDescription>
        </Alert>
      </form>

      <!-- Шаг 4: итог -->
      <div v-else-if="step === 'result' && result" class="grid gap-4">
        <dl
          class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 rounded-lg border p-3 text-[13.5px]"
        >
          <dt>{{ t("panel.imports.result.imported") }}</dt>
          <dd class="text-right font-medium tabular-nums">
            {{ result.imported }}
          </dd>
          <dt>{{ t("panel.imports.result.unchanged") }}</dt>
          <dd class="text-right tabular-nums">
            {{ result.unchanged }}
          </dd>
          <dt>{{ t("panel.imports.result.unmatched") }}</dt>
          <dd class="text-right tabular-nums">
            {{ result.unmatched }}
          </dd>
        </dl>
        <Alert v-if="result.unmatched > 0" variant="info">
          <InfoIcon />
          <AlertDescription>
            {{ t("panel.imports.result.unmatchedHint") }}
          </AlertDescription>
        </Alert>
        <Alert v-if="actionFailed" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>
            {{ t("panel.imports.errors.undoFailed") }}
          </AlertDescription>
        </Alert>
      </div>

      <DialogFooter class="sm:justify-between">
        <template v-if="step === 'files'">
          <span class="hidden sm:block" />
          <div class="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" @click="open = false">
              {{ t("panel.common.cancel") }}
            </Button>
            <LoadingButton
              type="submit"
              form="import-files"
              :loading="filesForm.isSubmitting.value"
            >
              {{ t("panel.imports.dialog.upload") }}
            </LoadingButton>
          </div>
        </template>

        <template v-else-if="step === 'matching' || step === 'preview'">
          <LoadingButton
            variant="ghost"
            :loading="busy === 'cancel'"
            :disabled="!!busy || applyForm.isSubmitting.value"
            @click="onCancel"
          >
            {{ t("panel.imports.dialog.cancelImport") }}
          </LoadingButton>
          <div class="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" @click="open = false">
              {{ t("panel.common.close") }}
            </Button>
            <LoadingButton
              v-if="step === 'preview'"
              type="submit"
              form="import-apply"
              :loading="applyForm.isSubmitting.value"
              :disabled="!!busy || !preview"
            >
              {{ t("panel.imports.dialog.apply") }}
            </LoadingButton>
          </div>
        </template>

        <template v-else-if="step === 'failed'">
          <span class="hidden sm:block" />
          <div class="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" @click="open = false">
              {{ t("panel.common.close") }}
            </Button>
            <Button @click="step = 'files'">
              {{ t("panel.imports.dialog.again") }}
            </Button>
          </div>
        </template>

        <template v-else>
          <LoadingButton
            variant="ghost"
            :loading="busy === 'undo'"
            :disabled="!!busy"
            @click="onUndo"
          >
            {{ t("panel.imports.dialog.undo") }}
          </LoadingButton>
          <div class="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              v-if="result && result.unmatched > 0"
              variant="outline"
              as-child
            >
              <NuxtLink :to="`/people/${profileId}/import`">
                {{ t("panel.imports.dialog.matchManually") }}
              </NuxtLink>
            </Button>
            <Button @click="open = false">
              {{ t("panel.imports.dialog.done") }}
            </Button>
          </div>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
