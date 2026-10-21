<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
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
  <div class="flex w-full max-w-sm flex-col items-center gap-6">
    <div class="flex items-center gap-2 text-xl font-semibold">
      <BrandMark class="size-7" />
      Torsher
    </div>
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Создайте аккаунт</CardTitle>
        <CardDescription>
          Аккаунт владельца сервера: с ним вы входите в панель и настраиваете
          Torsher. Второй аккаунт создать нельзя.
        </CardDescription>
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

          <LoadingButton type="submit" :loading="isSubmitting">
            Создать аккаунт
          </LoadingButton>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
