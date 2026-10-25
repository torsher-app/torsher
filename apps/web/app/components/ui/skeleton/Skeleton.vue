<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface SkeletonProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<SkeletonProps>()
</script>

<template>
  <!-- Проявляется через --loader-delay, мерцает слой before (tailwind.css).
       Своего фона у элемента нет: он закрыл бы мерцание -->
  <div
    data-slot="skeleton"
    :class="
      cn(
        'relative rounded-md animate-skeleton-in before:absolute before:inset-0 before:rounded-[inherit] before:bg-muted before:animate-skeleton-pulse',
        props.class,
      )
    "
  />
</template>
