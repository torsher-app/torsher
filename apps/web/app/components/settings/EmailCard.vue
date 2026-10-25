<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue'
import { getErrorStatus } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { getErrorMessage, retryAfterMinutes } from '~/services/api'
import SettingsCard from './SettingsCard.vue'

const { t } = useI18n()
const { user, changeEmail } = useUser()

const formError = ref('')

// Email — логин: смену подтверждает текущий пароль, как на сервере
const schema = toTypedSchema(
  z.object({
    email: z.email(t('panel.auth.validation.email')),
    currentPassword: z
      .string()
      .min(1, t('panel.auth.validation.passwordRequired')),
  }),
)

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  meta,
  resetForm,
  setFieldError,
} = useForm({
  validationSchema: schema,
  initialValues: { email: user.value?.email ?? '', currentPassword: '' },
})

const [email, emailProps] = defineField('email')
// Без проверки по blur: после сохранения поле пустое, а фокус остаётся в нём
const [currentPassword, currentPasswordProps] = defineField('currentPassword', {
  validateOnBlur: false,
})

const onSubmit = handleSubmit(async (values) => {
  formError.value = ''

  try {
    await withErrorMode('silent', () => changeEmail(values))
  }
  catch (err) {
    if (getErrorStatus(err) === 403) {
      setFieldError(
        'currentPassword',
        t('panel.settings.account.validation.wrongPassword'),
      )
    }
    else {
      const minutes = await retryAfterMinutes(err)

      formError.value = minutes
        ? t('panel.auth.tooManyAttempts', { n: minutes })
        : await getErrorMessage(err)
    }

    return
  }

  resetForm({
    values: { email: user.value?.email ?? '', currentPassword: '' },
  })
  toast.success(t('panel.settings.account.emailSaved'), {
    description: t('panel.settings.account.signedOut'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.account.emailTitle')"
      :description="t('panel.settings.account.emailText')"
    >
      <Alert v-if="formError" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{{ t("panel.settings.account.failed") }}</AlertTitle>
        <AlertDescription>{{ formError }}</AlertDescription>
      </Alert>

      <div class="grid max-w-sm gap-4">
        <div class="grid gap-2">
          <Label for="account-email">{{ t("panel.auth.email") }}</Label>
          <Input
            id="account-email"
            v-model="email"
            v-bind="emailProps"
            type="email"
            autocomplete="email"
            :aria-invalid="!!errors.email || undefined"
          />
          <p v-if="errors.email" class="text-[12.5px] text-destructive">
            {{ errors.email }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="email-current-password">{{
            t("panel.settings.account.currentPassword")
          }}</Label>
          <SecretInput
            id="email-current-password"
            v-model="currentPassword"
            v-bind="currentPasswordProps"
            autocomplete="current-password"
            :aria-invalid="!!errors.currentPassword || undefined"
            :show-label="t('panel.auth.showPassword')"
            :hide-label="t('panel.auth.hidePassword')"
          />
          <p
            v-if="errors.currentPassword"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.currentPassword }}
          </p>
        </div>
      </div>

      <template #hint>
        {{ t("panel.settings.account.emailHint") }}
      </template>
      <template #action>
        <LoadingButton
          type="submit"
          size="sm"
          :loading="isSubmitting"
          :disabled="!meta.dirty"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </template>
    </SettingsCard>
  </form>
</template>
