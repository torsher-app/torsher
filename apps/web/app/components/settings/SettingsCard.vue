<script setup lang="ts">
import {
  Card,
  CardDescription,
  CardFooter,
  CardTitle,
} from '@/components/ui/card'

defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <!-- Одна настройка — одна карточка: подсказка или текущее значение слева в футере, действие справа -->
  <Card class="gap-0 py-0">
    <div class="grid gap-3 p-5">
      <div class="grid gap-1">
        <!-- Бейдж у заголовка — свойство настройки («После перезапуска»), а не её значение -->
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <CardTitle class="text-base font-semibold tracking-tight">
            {{ title }}
          </CardTitle>
          <slot name="badge" />
        </div>
        <CardDescription class="max-w-[62ch]">
          {{ description }}
        </CardDescription>
      </div>
      <slot />
    </div>
    <CardFooter
      class="flex-wrap justify-between gap-3 border-t bg-muted/50 px-5 py-3 text-[13px] text-muted-foreground [.border-t]:pt-3"
    >
      <span class="min-w-0"><slot name="hint" /></span>
      <slot name="action" />
    </CardFooter>
  </Card>
</template>
