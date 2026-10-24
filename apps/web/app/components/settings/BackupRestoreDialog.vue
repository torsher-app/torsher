<script setup lang="ts">
import type { BackupItem } from '@torsher/api-client'
import type { BackupProblem } from '~/lib/backups'
import type { RestoreOutcome } from '~/composables/useRestoreFlow'
import { CircleAlertIcon, MonitorPlayIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { toBackupRequestError } from '~/composables/useBackups'
import { backupErrorText, formatDayTime } from '~/lib/backups'
import { dialogSheetClass } from '~/lib/dialog'
import { api } from '~/services/api'

const props = defineProps<{
  item: BackupItem | null
}>()

const emit = defineEmits<{
  finished: [outcome: Extract<RestoreOutcome, { kind: 'finished' }>]
}>()

const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const { phase, follow } = useRestoreFlow()

const base = 'panel.backups.restore'

// Предел — как в DTO сервера
const schema = toTypedSchema(
  z.object({
    password: z
      .string()
      .max(1024, t('panel.backups.encryption.validation.max')),
  }),
)

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  resetForm,
  setFieldError,
} = useForm({ validationSchema: schema, initialValues: { password: '' } })

const [password, passwordProps] = defineField('password', {
  validateOnBlur: false,
})

const failure = ref<BackupProblem | null>(null)
const watching = ref(0)

const date = computed(() =>
  props.item ? formatDayTime(props.item.createdAt, locale.value) : '',
)
const busy = computed(() => isSubmitting.value || phase.value === 'checking')

/** Кто смотрит сейчас: один запрос при открытии, без ответа — без предупреждения */
async function loadWatching() {
  try {
    const overview = await withErrorMode('silent', () =>
      api.overview.getOverview())

    watching.value = overview.devices.watching
  }
  catch {}
}

watch(open, (isOpen) => {
  if (!isOpen)
    return

  resetForm()
  failure.value = null
  watching.value = 0
  void loadWatching()
})

// Сервер ушёл на перезапуск: дальше экран перезапуска поверх страницы
watch(phase, (value) => {
  if (value === 'restarting')
    open.value = false
})

const onSubmit = handleSubmit(async (values) => {
  if (!props.item)
    return

  failure.value = null

  try {
    await withErrorMode('silent', () =>
      api.backups.postBackupRestore(props.item!.name, {
        password: values.password || undefined,
      }))
  }
  catch (err) {
    const { problem } = await toBackupRequestError(err)

    if (problem.kind === 'wrong_password')
      setFieldError('password', t('panel.backups.errors.wrong_password'))
    else failure.value = problem

    return
  }

  const outcome = await follow()

  if (outcome.kind === 'cancelled')
    return

  if (outcome.kind === 'failed') {
    failure.value = {
      kind: outcome.restore.reason ?? 'unknown',
      params: outcome.restore.params,
    }
    return
  }

  emit('finished', outcome)
})
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent :class="dialogSheetClass">
      <AlertDialogHeader class="place-items-start text-left">
        <AlertDialogTitle>{{ t(`${base}.title`) }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t(`${base}.text`, { date }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <form
        id="backup-restore"
        class="grid min-w-0 gap-4"
        novalidate
        @submit="onSubmit"
      >
        <Alert v-if="failure" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t(`${base}.failedTitle`) }}</AlertTitle>
          <AlertDescription>
            {{ backupErrorText(t, locale, failure) }}. {{ t(`${base}.keep`) }}
          </AlertDescription>
        </Alert>

        <ul
          class="grid list-disc gap-1 pl-5 text-[13.5px] text-muted-foreground marker:text-muted-foreground/60"
        >
          <li>{{ t(`${base}.before`) }}</li>
          <li>{{ t(`${base}.restart`) }}</li>
        </ul>

        <div v-if="item?.encrypted" class="grid gap-2">
          <Label for="backup-restore-password">{{
            t(`${base}.password`)
          }}</Label>
          <SecretInput
            id="backup-restore-password"
            v-model="password"
            v-bind="passwordProps"
            autocomplete="off"
            aria-describedby="backup-restore-password-hint"
            :aria-invalid="!!errors.password || undefined"
            :show-label="t('panel.auth.showPassword')"
            :hide-label="t('panel.auth.hidePassword')"
          />
          <p
            v-if="errors.password"
            id="backup-restore-password-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.password }}
          </p>
          <p
            v-else
            id="backup-restore-password-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t(`${base}.passwordHint`) }}
          </p>
        </div>

        <!-- Предупреждение — последним: появившись, оно не сдвигает то, что уже читают -->
        <Alert v-if="watching" variant="warning" aria-live="polite">
          <MonitorPlayIcon />
          <AlertTitle class="tabular-nums">
            {{ t(`${base}.watching`, { n: watching }, watching) }}
          </AlertTitle>
        </Alert>
      </form>

      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">
          {{ t("panel.common.cancel") }}
        </AlertDialogCancel>
        <LoadingButton
          type="submit"
          form="backup-restore"
          variant="destructive"
          :loading="busy"
        >
          {{ t(`${base}.confirm`) }}
        </LoadingButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
