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
import { usernameSchema } from '~/lib/username'
import { getErrorMessage, retryAfterMinutes } from '~/services/api'
import SettingsCard from './SettingsCard.vue'

const { t } = useI18n()
const { user, changeUsername } = useUser()

const formError = ref('')

// Имя пользователя — логин: смену подтверждает текущий пароль, как на сервере
const schema = toTypedSchema(
  z.object({
    username: usernameSchema(t('panel.auth.validation.username')),
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
  resetForm,
  setFieldError,
} = useForm({
  validationSchema: schema,
  initialValues: { username: user.value?.username ?? '', currentPassword: '' },
})

const [username, usernameProps] = defineField('username')
// Без проверки по blur: после сохранения поле пустое, а фокус остаётся в нём
const [currentPassword, currentPasswordProps] = defineField('currentPassword', {
  validateOnBlur: false,
})

// Пароль нужен только для сохранения нового имени: до правки поле не показываем
const isRenaming = computed(
  () => (username.value ?? '').trim() !== (user.value?.username ?? ''),
)

const onSubmit = handleSubmit(async (values) => {
  formError.value = ''

  try {
    await withErrorMode('silent', () => changeUsername(values))
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
    values: { username: user.value?.username ?? '', currentPassword: '' },
  })
  toast.success(t('panel.settings.account.usernameSaved'), {
    description: t('panel.settings.account.signedOut'),
  })
})
</script>

<template>
  <form novalidate @submit="onSubmit">
    <SettingsCard
      :title="t('panel.settings.account.usernameTitle')"
      :description="t('panel.settings.account.usernameText')"
    >
      <Alert v-if="formError" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{{ t("panel.settings.account.failed") }}</AlertTitle>
        <AlertDescription>{{ formError }}</AlertDescription>
      </Alert>

      <div class="grid max-w-sm gap-4">
        <div class="grid gap-2">
          <!-- Видимая подпись повторила бы заголовок карточки -->
          <Label for="account-username" class="sr-only">{{
            t("panel.auth.username")
          }}</Label>
          <Input
            id="account-username"
            v-model="username"
            v-bind="usernameProps"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            :aria-invalid="!!errors.username || undefined"
          />
          <p v-if="errors.username" class="text-[12.5px] text-destructive">
            {{ errors.username }}
          </p>
        </div>

        <div v-if="isRenaming" class="grid gap-2">
          <Label for="username-current-password">{{
            t("panel.settings.account.currentPassword")
          }}</Label>
          <SecretInput
            id="username-current-password"
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
        {{ t("panel.settings.account.usernameHint") }}
      </template>
      <template #action>
        <LoadingButton
          type="submit"
          size="sm"
          :loading="isSubmitting"
          :disabled="!isRenaming"
        >
          {{ t("panel.common.save") }}
        </LoadingButton>
      </template>
    </SettingsCard>
  </form>
</template>
