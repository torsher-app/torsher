<script setup lang="ts">
import type { AboutResponse } from '@torsher/api-client'
import { CircleAlertIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import ResetPasswordHelp from '~/components/auth/ResetPasswordHelp.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import SecretInput from '~/components/SecretInput.vue'
import BrandMark from '~/components/shell/BrandMark.vue'
import { getErrorStatus } from '@torsher/api-client'
import { api, getErrorMessage, retryAfterMinutes } from '~/services/api'

definePageMeta({
  layout: 'auth',
  middleware: ['guest-only', 'first-run'],
})

const { signin } = useAuth()
const { t } = useI18n()

const isRejected = ref(false)
const isResetShown = ref(false)
// Вход прошёл, а страница ещё не сменилась: панель догружается или браузер
// уходит на витрину. Кнопка крутится до конца, а не оживает на миг
const isLeaving = ref(false)
const formError = ref('')
const about = shallowRef<AboutResponse>()

const schema = toTypedSchema(
  z.object({
    email: z.email(t('panel.auth.validation.email')),
    password: z.string().min(1, t('panel.auth.validation.passwordRequired')),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting } = useForm({
  validationSchema: schema,
  initialValues: { email: '', password: '' },
})

const [email, emailProps] = defineField('email')
const [password, passwordProps] = defineField('password')

// Ошибку входа показываем в форме, а не тостом: она относится к полям
const onSubmit = handleSubmit(async (values) => {
  isRejected.value = false
  formError.value = ''

  try {
    await withErrorMode('silent', () => signin(values))
    isLeaving.value = true
  }
  catch (err) {
    const minutes = await retryAfterMinutes(err)

    // 400 — неверная пара email и пароль; остальное — сервер или сеть
    if (getErrorStatus(err) === 400)
      isRejected.value = true
    else if (minutes)
      formError.value = t('panel.auth.tooManyAttempts', { n: minutes })
    else formError.value = await getErrorMessage(err)
  }
})

onMounted(async () => {
  about.value = await withErrorMode('silent', () => api.about.getAbout()).catch(
    () => undefined,
  )
})
</script>

<template>
  <div class="grid w-full max-w-100 gap-5.5">
    <div
      class="flex items-center justify-center gap-2.5 text-xl font-semibold tracking-tight"
    >
      <BrandMark class="size-6.5" />
      Torsher
    </div>

    <Card class="gap-4.5 p-6">
      <header>
        <h1 class="text-xl font-semibold tracking-tight">
          {{ t("panel.auth.loginTitle") }}
        </h1>
        <p class="mt-1 text-[13.5px] text-muted-foreground">
          {{ t("panel.auth.loginText") }}
        </p>
      </header>

      <form class="grid gap-4" novalidate @submit="onSubmit">
        <Alert v-if="isRejected" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t("panel.auth.rejected") }}</AlertTitle>
          <AlertDescription>
            {{ t("panel.auth.rejectedText") }}
          </AlertDescription>
        </Alert>
        <Alert v-else-if="formError" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{{ t("panel.auth.failed") }}</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="grid gap-2">
          <Label for="email">{{ t("panel.auth.email") }}</Label>
          <Input
            id="email"
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
          <div class="flex items-center justify-between gap-3">
            <Label for="password">{{ t("panel.auth.password") }}</Label>
            <Button
              type="button"
              variant="link"
              size="xs"
              class="h-auto p-0 text-[12.5px] text-muted-foreground"
              aria-controls="reset-password-help"
              :aria-expanded="isResetShown"
              @click="isResetShown = !isResetShown"
            >
              {{ t("panel.auth.forgot") }}
            </Button>
          </div>
          <SecretInput
            id="password"
            v-model="password"
            v-bind="passwordProps"
            autocomplete="current-password"
            :aria-invalid="!!errors.password || isRejected || undefined"
            :show-label="t('panel.auth.showPassword')"
            :hide-label="t('panel.auth.hidePassword')"
          />
          <p v-if="errors.password" class="text-[12.5px] text-destructive">
            {{ errors.password }}
          </p>
        </div>

        <LoadingButton
          type="submit"
          class="w-full"
          :loading="isSubmitting || isLeaving"
        >
          {{ t("panel.auth.submit") }}
        </LoadingButton>
      </form>

      <ResetPasswordHelp v-show="isResetShown" id="reset-password-help" />
    </Card>

    <div
      class="flex justify-center gap-3.5 text-[12.5px] text-muted-foreground"
    >
      <NuxtLink to="/settings/about" class="underline underline-offset-3">
        {{ t("common.about") }}
      </NuxtLink>
      <span v-if="about" class="tabular-nums">Torsher {{ about.version }}</span>
    </div>
  </div>
</template>
