<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '~/services/api'

definePageMeta({
  middleware: 'guest-only',
})

const { signup } = useAuth()

const formError = ref('')

// Правила совпадают с DTO бэкенда: имя от 2 символов, пароль от 8
const schema = toTypedSchema(
  z.object({
    name: z.string().min(2, 'Минимум 2 символа'),
    email: z.email('Введите корректный email'),
    password: z.string().min(8, 'Минимум 8 символов'),
  }),
)

const { handleSubmit, defineField, errors, isSubmitting } = useForm({
  validationSchema: schema,
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
    formError.value = await getErrorMessage(err)
  }
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Регистрация</CardTitle>
        <CardDescription>Создайте аккаунт</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-4" @submit="onSubmit">
          <div class="grid gap-2">
            <Label for="name">Имя</Label>
            <Input
              id="name"
              v-model="name"
              v-bind="nameProps"
              autocomplete="name"
            />
            <p v-if="errors.name" class="text-sm text-destructive">
              {{ errors.name }}
            </p>
          </div>

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
              autocomplete="new-password"
            />
            <p v-if="errors.password" class="text-sm text-destructive">
              {{ errors.password }}
            </p>
          </div>

          <p v-if="formError" class="text-sm text-destructive">
            {{ formError }}
          </p>

          <Button type="submit" :disabled="isSubmitting">
            Создать аккаунт
          </Button>

          <p class="text-center text-sm text-muted-foreground">
            Уже есть аккаунт?
            <NuxtLink to="/auth/login" class="underline">
              Войти
            </NuxtLink>
          </p>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
