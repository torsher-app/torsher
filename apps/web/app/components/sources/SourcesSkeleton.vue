<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'
</script>

<template>
  <!-- Повторяет список индексаторов, чтобы разметка не прыгала после загрузки -->
  <div class="grid gap-3" aria-busy="true">
    <Skeleton class="h-5 w-32" />
    <ul class="divide-y rounded-xl border">
      <li v-for="row in 3" :key="row" class="grid gap-2 p-4">
        <Skeleton class="h-5 w-48" />
        <Skeleton class="h-4 w-64 max-w-full" />
        <Skeleton class="h-5 w-40" />
      </li>
    </ul>
  </div>
</template>
