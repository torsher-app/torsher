<script setup lang="ts">
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { Card, CardFooter } from '@/components/ui/card'

defineProps<{
  to: RouteLocationRaw
  title: string
  icon: Component
}>()
</script>

<template>
  <!-- Плитка целиком — ссылка в раздел: клик по любой цифре ведёт туда же -->
  <NuxtLink
    :to="to"
    class="group/tile block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <!-- Наведение — тот же фон и без анимации, как у строки списка -->
    <Card
      class="h-full gap-0 py-0 group-hover/tile:bg-muted/50 dark:group-hover/tile:bg-muted"
    >
      <div class="grid flex-1 content-start gap-2 p-5">
        <span
          class="flex items-center gap-2 text-[13px] font-medium text-muted-foreground"
        >
          <component
            :is="icon"
            class="size-4 shrink-0 -translate-y-px"
            aria-hidden="true"
          />
          {{ title }}
          <slot name="badge" />
        </span>
        <slot />
      </div>
      <CardFooter
        class="min-h-11 gap-2 border-t bg-muted/50 px-5 py-3 text-[13px] text-muted-foreground [.border-t]:pt-3"
      >
        <slot name="footer" />
      </CardFooter>
    </Card>
  </NuxtLink>
</template>
