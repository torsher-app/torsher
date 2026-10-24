<script setup lang="ts">
import type { BackupProblem } from '~/lib/backups'
import { CircleAlertIcon, FileUpIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
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
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import {
  BackupRequestError,
  toBackupRequestError,
} from '~/composables/useBackups'
import { backupErrorText } from '~/lib/backups'
import { dialogSheetClass } from '~/lib/dialog'
import { api } from '~/services/api'

const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const { uploadFile } = useBackups()
const { phase, follow } = useRestoreFlow()
const { markDone } = useSetup()

const base = 'panel.backups.setup'

// Копия под паролем — по расширению: заголовок файла проверит сервер
const isLocked = (file?: { name?: string }) => !!file?.name?.endsWith('.enc')

const schema = toTypedSchema(
  z
    .object({
      file: z.instanceof(File, { message: t(`${base}.validation.file`) }),
      // Предел — как в DTO сервера
      password: z
        .string()
        .max(1024, t('panel.backups.encryption.validation.max')),
    })
    .superRefine((values, ctx) => {
      if (isLocked(values.file) && !values.password) {
        ctx.addIssue({
          code: 'custom',
          path: ['password'],
          message: t(`${base}.validation.password`),
        })
      }
    }),
)

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  resetForm,
  setFieldError,
} = useForm({
  validationSchema: schema,
  initialValues: { file: undefined, password: '' },
})

const [file] = defineField('file')
const [password, passwordProps] = defineField('password', {
  validateOnBlur: false,
})

const failure = ref<BackupProblem | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
// Загруженная копия остаётся на сервере: повтор с другим паролем её не грузит
let uploaded: { file: File, name: string } | null = null

const busy = computed(() => isSubmitting.value || phase.value === 'checking')

watch(open, (isOpen) => {
  if (isOpen && phase.value === 'idle' && !failure.value) {
    resetForm()
    uploaded = null
  }
})

watch(phase, (value) => {
  if (value === 'restarting')
    open.value = false
})

function onFile(event: Event) {
  const input = event.target as HTMLInputElement

  file.value = input.files?.[0]
  failure.value = null
  input.value = ''
}

async function uploadOnce(selected: File) {
  if (uploaded?.file === selected)
    return uploaded.name

  const item = await uploadFile(selected)

  uploaded = { file: selected, name: item.name }

  return item.name
}

const onSubmit = handleSubmit(async (values) => {
  failure.value = null

  const restore = async () => {
    const name = await uploadOnce(values.file)

    await withErrorMode('silent', () =>
      api.backups.postBackupRestore(name, {
        password: values.password || undefined,
      }))
  }

  try {
    try {
      await restore()
    }
    catch (err) {
      // Загруженной копии на сервере уже нет (перезапуск чистит временный
      // каталог): загружаем файл заново один раз
      if (
        !uploaded
        || (await toBackupRequestError(err)).problem.kind !== 'not_found'
      ) {
        throw err
      }

      uploaded = null
      await restore()
    }
  }
  catch (err) {
    const { problem }
      = err instanceof BackupRequestError ? err : await toBackupRequestError(err)

    if (problem.kind === 'wrong_password')
      setFieldError('password', t('panel.backups.errors.wrong_password'))
    else failure.value = problem

    return
  }

  const outcome = await follow()

  if (outcome.kind === 'cancelled')
    return

  // Сервер перезапустился: загруженная копия удалена вместе с временным каталогом
  if (outcome.kind === 'finished')
    uploaded = null

  if (outcome.kind === 'failed' || outcome.restore?.state === 'failed') {
    const restore = outcome.restore

    failure.value = {
      kind: restore?.reason ?? 'unknown',
      params: restore?.params,
    }
    open.value = true
    return
  }

  // Аккаунт пришёл из копии: дальше — вход паролем старого сервера
  markDone()
  toast.success(t(`${base}.done`), { description: t(`${base}.doneText`) })
  await navigateTo('/auth/login')
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader class="text-left">
        <DialogTitle>{{ t(`${base}.title`) }}</DialogTitle>
        <DialogDescription>{{ t(`${base}.text`) }}</DialogDescription>
      </DialogHeader>

      <form
        id="setup-restore"
        class="grid min-w-0 gap-4"
        novalidate
        @submit="onSubmit"
      >
        <Alert v-if="failure" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t("panel.backups.restore.failedTitle") }}</AlertTitle>
          <AlertDescription>
            {{ backupErrorText(t, locale, failure) }}
          </AlertDescription>
        </Alert>

        <div class="grid min-w-0 gap-2">
          <Label for="setup-restore-file">{{ t(`${base}.file`) }}</Label>
          <div class="flex min-w-0 items-center gap-3">
            <Button
              id="setup-restore-file"
              type="button"
              variant="outline"
              :aria-invalid="!!errors.file || undefined"
              aria-describedby="setup-restore-file-hint"
              @click="fileInput?.click()"
            >
              <FileUpIcon aria-hidden="true" />
              {{ t(`${base}.choose`) }}
            </Button>
            <span
              class="min-w-0 truncate font-mono text-xs"
              :class="{ 'text-muted-foreground': !file }"
              :title="file?.name"
            >
              {{ file?.name ?? t(`${base}.noFile`) }}
            </span>
            <input
              ref="fileInput"
              type="file"
              accept=".gz,.enc"
              class="hidden"
              @change="onFile"
            >
          </div>
          <p
            v-if="errors.file"
            id="setup-restore-file-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.file }}
          </p>
          <p
            v-else
            id="setup-restore-file-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t(`${base}.fileHint`) }}
          </p>
        </div>

        <div v-if="isLocked(file)" class="grid gap-2">
          <Label for="setup-restore-password">{{
            t(`${base}.password`)
          }}</Label>
          <SecretInput
            id="setup-restore-password"
            v-model="password"
            v-bind="passwordProps"
            autocomplete="off"
            aria-describedby="setup-restore-password-hint"
            :aria-invalid="!!errors.password || undefined"
            :show-label="t('panel.auth.showPassword')"
            :hide-label="t('panel.auth.hidePassword')"
          />
          <p
            v-if="errors.password"
            id="setup-restore-password-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.password }}
          </p>
          <p
            v-else
            id="setup-restore-password-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t(`${base}.passwordHint`) }}
          </p>
        </div>
      </form>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="open = false">
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton type="submit" form="setup-restore" :loading="busy">
          {{ t(`${base}.submit`) }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
