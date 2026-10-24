<script setup lang="ts">
import {
  ArchiveRestoreIcon,
  ArrowRightIcon,
  CircleAlertIcon,
} from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import RestoreBackupDialog from '~/components/auth/RestoreBackupDialog.vue'
import SecretInput from '~/components/SecretInput.vue'
import BackupRestartScreen from '~/components/settings/BackupRestartScreen.vue'
import { getErrorStatus } from '@torsher/api-client'
import { getErrorMessage } from '~/services/api'

definePageMeta({
  layout: 'wizard',
  wizardStep: 1,
  middleware: ['guest-only', 'first-run'],
})

const { signup } = useAuth()
const { t } = useI18n()

const formError = ref('')
const restoreOpen = ref(false)

// Правила совпадают с DTO бэкенда: имя от 2 символов, пароль от 8
const schema = toTypedSchema(
  z.object({
    name: z.string().trim().min(2, t('panel.auth.validation.name')),
    email: z.email(t('panel.auth.validation.email')),
    password: z.string().min(8, t('panel.auth.validation.password')),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting } = useForm({
  validationSchema: schema,
  initialValues: { name: '', email: '', password: '' },
})

const [name, nameProps] = defineField('name')
const [email, emailProps] = defineField('email')
const [password, passwordProps] = defineField('password')

const onSubmit = handleSubmit(async (values) => {
  formError.value = ''

  try {
    await withErrorMode('silent', () => signup(values))
  }
  catch (err) {
    // 409 — на сервере идёт восстановление из копии: аккаунт придёт из неё
    formError.value
      = getErrorStatus(err) === 409
        ? t('panel.backups.setup.restoring')
        : await getErrorMessage(err)
  }
})
</script>

<template>
  <header>
    <h1 class="text-2xl font-semibold tracking-tight text-balance">
      {{ t("panel.wizard.account.title") }}
    </h1>
    <p class="mt-1.5 max-w-[58ch] text-muted-foreground">
      {{ t("panel.wizard.account.text") }}
    </p>
  </header>

  <form class="grid gap-4" novalidate @submit="onSubmit">
    <Alert v-if="formError" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{{ t("panel.wizard.account.failed") }}</AlertTitle>
      <AlertDescription>{{ formError }}</AlertDescription>
    </Alert>

    <div class="grid gap-2">
      <Label for="name">{{ t("panel.auth.name") }}</Label>
      <Input
        id="name"
        v-model="name"
        v-bind="nameProps"
        autocomplete="name"
        :aria-invalid="!!errors.name || undefined"
      />
      <p v-if="errors.name" class="text-[12.5px] text-destructive">
        {{ errors.name }}
      </p>
    </div>

    <div class="grid gap-2">
      <Label for="email">{{ t("panel.auth.email") }}</Label>
      <Input
        id="email"
        v-model="email"
        v-bind="emailProps"
        type="email"
        autocomplete="email"
        aria-describedby="email-hint"
        :aria-invalid="!!errors.email || undefined"
      />
      <p
        v-if="errors.email"
        id="email-hint"
        class="text-[12.5px] text-destructive"
      >
        {{ errors.email }}
      </p>
      <p v-else id="email-hint" class="text-[12.5px] text-muted-foreground">
        {{ t("panel.wizard.account.emailHint") }}
      </p>
    </div>

    <div class="grid gap-2">
      <Label for="password">{{ t("panel.auth.password") }}</Label>
      <SecretInput
        id="password"
        v-model="password"
        v-bind="passwordProps"
        autocomplete="new-password"
        aria-describedby="password-hint"
        :aria-invalid="!!errors.password || undefined"
        :show-label="t('panel.auth.showPassword')"
        :hide-label="t('panel.auth.hidePassword')"
      />
      <p
        v-if="errors.password"
        id="password-hint"
        class="text-[12.5px] text-destructive"
      >
        {{ errors.password }}
      </p>
      <p v-else id="password-hint" class="text-[12.5px] text-muted-foreground">
        {{ t("panel.auth.validation.password") }}
      </p>
    </div>

    <div
      class="flex flex-col-reverse gap-2 pt-1.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <!-- Перенос со старого сервера — вместо нового аккаунта, а не после него -->
      <Button
        type="button"
        variant="ghost"
        class="w-full sm:-ml-3 sm:w-auto"
        :disabled="isSubmitting"
        @click="restoreOpen = true"
      >
        <ArchiveRestoreIcon aria-hidden="true" />
        {{ t("panel.backups.setup.link") }}
      </Button>
      <LoadingButton
        type="submit"
        class="w-full sm:w-auto"
        :loading="isSubmitting"
      >
        {{ t("panel.wizard.account.submit") }}
        <ArrowRightIcon aria-hidden="true" />
      </LoadingButton>
    </div>
  </form>

  <RestoreBackupDialog v-model:open="restoreOpen" />
  <BackupRestartScreen />
</template>
