<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

definePageMeta({
  middleware: 'required-auth',
})

const { user } = useUser()
const { logout } = useAuth()
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <Card class="w-full max-w-md">
      <CardHeader>
        <CardTitle>Привет, {{ user?.name }}</CardTitle>
        <CardDescription>{{ user?.email }}</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <p class="text-sm text-muted-foreground">
          Это защищённая страница: без валидной сессии сюда не попасть.
        </p>
        <Button variant="outline" @click="logout">
          Выйти
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
