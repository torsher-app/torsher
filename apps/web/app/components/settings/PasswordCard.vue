<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue'
import { getErrorStatus } from '@torsher/api-client'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import { getErrorMessage } from '~/services/api'
import SettingsCard from './SettingsCard.vue'

const { t } = useI18n()
const { user, changePassword } = useUser()

const formError = ref('')

// Длина нового пароля — как в DTO сервера: от 8 символов
const schema = toTypedSchema(
  z
    .object({
      currentPassword: z
        .string()
        .min(1, t('panel.auth.validation.passwordRequired')),
      newPassword: z.string().min(8, t('panel.auth.validation.password')),
      repeatPassword: z.string(),
    })
    .refine(values => values.newPassword === values.repeatPassword, {
      message: t('panel.settings.account.validation.mismatch'),
      path: ['repeatPassword'],
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
  initialValues: { currentPassword: '', newPassword: '', repeatPassword: '' },
})

// Без проверки по blur: после сохранения форма пустая, а фокус остаётся в поле,
// и первый же клик мимо показал бы «Введите пароль»
const fieldConfig = { validateOnBlur: false }

const [currentPassword, currentPasswordProps] = defineField(
  'currentPassword',
  fieldConfig,
)
const [newPassword, newPasswordProps] = defineField('newPassword', fieldConfig)
const [repeatPassword, repeatPasswordProps] = defineField(
  'repeatPassword',
  fieldConfig,
)

const onSubmit = handleSubmit(async (values) => {
  formError.value = ''

  try {
    await withErrorMode('silent', () =>
      changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }))
  }
  catch (err) {
    // 403 — неверный текущий пароль: ошибка встаёт у его поля
    if (getErrorStatus(err) === 403) {
      setFieldError(
        'currentPassword',
        t('panel.settings.account.validation.wrongPassword'),
      )
    }
    else {
      formError.value = await getErrorMessage(err)
    }

    return
  }

  resetForm()
  toast.success(t('panel.settings.account.passwordSaved'), {
    description: t('panel.settings.account.signedOut'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.account.passwordTitle')"
      :description="t('panel.settings.account.passwordText')"
    >
      <!-- Менеджер паролей обновляет сохранённую запись по логину рядом с паролем -->
      <input
        type="email"
        name="username"
        autocomplete="username"
        :value="user?.email"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        readonly
      >

      <Alert v-if="formError" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{{ t("panel.settings.account.failed") }}</AlertTitle>
        <AlertDescription>{{ formError }}</AlertDescription>
      </Alert>

      <div class="grid max-w-sm gap-4">
        <div class="grid gap-2">
          <Label for="current-password">{{
            t("panel.settings.account.currentPassword")
          }}</Label>
          <SecretInput
            id="current-password"
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

        <div class="grid gap-2">
          <Label for="new-password">{{
            t("panel.settings.account.newPassword")
          }}</Label>
          <SecretInput
            id="new-password"
            v-model="newPassword"
            v-bind="newPasswordProps"
            autocomplete="new-password"
            :aria-invalid="!!errors.newPassword || undefined"
            :show-label="t('panel.auth.showPassword')"
            :hide-label="t('panel.auth.hidePassword')"
          />
          <p v-if="errors.newPassword" class="text-[12.5px] text-destructive">
            {{ errors.newPassword }}
          </p>
          <p v-else class="text-[12.5px] text-muted-foreground">
            {{ t("panel.settings.account.passwordHint") }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="repeat-password">{{
            t("panel.settings.account.repeatPassword")
          }}</Label>
          <SecretInput
            id="repeat-password"
            v-model="repeatPassword"
            v-bind="repeatPasswordProps"
            autocomplete="new-password"
            :aria-invalid="!!errors.repeatPassword || undefined"
            :show-label="t('panel.auth.showPassword')"
            :hide-label="t('panel.auth.hidePassword')"
          />
          <p
            v-if="errors.repeatPassword"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.repeatPassword }}
          </p>
        </div>
      </div>

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
