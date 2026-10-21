<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'

// Цвет иконки — по типу тоста, подробности приглушены. Тост выравнивает
// по верху: иконка 16 px опущена на 2 px к середине строки заголовка (20 px)
const toastOptions = {
  classes: {
    toast: 'rounded-xl! gap-3! items-start! [&_[data-icon]]:mt-0.5!',
    title: 'font-semibold! text-[13.5px]!',
    description: 'text-muted-foreground! text-[13px]!',
    success: '[&_[data-icon]]:text-success',
    error: '[&_[data-icon]]:text-destructive',
    info: '[&_[data-icon]]:text-info',
    warning: '[&_[data-icon]]:text-warning',
  },
}
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <Toaster
      position="bottom-right"
      :visible-toasts="3"
      :toast-options="toastOptions"
    />
  </div>
</template>
