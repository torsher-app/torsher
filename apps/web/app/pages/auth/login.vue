<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingButton from '~/components/LoadingButton.vue'
import BrandMark from '~/components/shell/BrandMark.vue'
import { getErrorMessage } from '~/services/api'

definePageMeta({
  middleware: ['guest-only', 'first-run'],
})

const { signin } = useAuth()
const { t } = useI18n()

const formError = ref('')

const schema = toTypedSchema(
  z.object({
    email: z.email('Введите корректный email'),
    password: z.string().min(1, 'Введите пароль'),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting } = useForm({
  validationSchema: schema,
})

const [email, emailProps] = defineField('email')
const [password, passwordProps] = defineField('password')

// Ошибку логина показываем в форме, а не тостом: она относится к полям
const onSubmit = handleSubmit(async (values) => {
  formError.value = ''

  try {
    await withErrorMode('silent', () => signin(values))
  }
  catch (err) {
    formError.value = await getErrorMessage(err)
  }
})
</script>

<template>
  <div class="flex w-full max-w-sm flex-col items-center gap-6">
    <div class="flex items-center gap-2 text-xl font-semibold">
      <BrandMark class="size-7" />
      Torsher
    </div>
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Вход</CardTitle>
        <CardDescription>Войдите в свой аккаунт</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-4" @submit="onSubmit">
          <div class="grid gap-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              v-model="email"
              v-bind="emailProps"
              type="email"
              autocomplete="email"
            />
            <p v-if="errors.email" class="text-sm text-destructive">
              {{ errors.email }}
            </p>
          </div>

          <div class="grid gap-2">
            <Label for="password">Пароль</Label>
            <Input
              id="password"
              v-model="password"
              v-bind="passwordProps"
              type="password"
              autocomplete="current-password"
            />
            <p v-if="errors.password" class="text-sm text-destructive">
              {{ errors.password }}
            </p>
          </div>

          <p v-if="formError" class="text-sm text-destructive">
            {{ formError }}
          </p>

          <LoadingButton type="submit" :loading="isSubmitting">
            Войти
          </LoadingButton>

          <NuxtLink
            to="/about"
            class="text-center text-sm text-muted-foreground underline"
          >
            {{ t("common.about") }}
          </NuxtLink>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
