<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'

withDefaults(
  defineProps<{
    /** Без строки фильтров — при смене фильтра она остаётся на месте */
    filters?: boolean
  }>(),
  { filters: true },
)
</script>

<template>
  <!-- Повторяет строку фильтров, заголовок группы и строки той же высоты -->
  <div aria-busy="true">
    <div
      v-if="filters"
      class="flex min-h-11 items-center gap-2 border-b pr-2.5 pl-3"
    >
      <Skeleton v-for="chip in 3" :key="chip" class="h-7 w-24 rounded-md" />
      <Skeleton class="ml-auto h-7 w-36 rounded-md sm:w-56" />
    </div>
    <div class="flex min-h-9 items-center border-b bg-muted px-4">
      <Skeleton class="h-3 w-20" />
    </div>
    <div
      v-for="row in 10"
      :key="row"
      class="grid grid-cols-[auto_16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 border-b py-2 pr-3 pl-4 sm:h-9 sm:grid-cols-[60px_16px_104px_minmax(0,1fr)_auto] sm:py-0"
    >
      <span class="flex h-5 items-center"><Skeleton class="h-3 w-14" /></span>
      <Skeleton class="size-3 justify-self-center rounded-full" />
      <span class="flex h-5 items-center"><Skeleton class="h-3 w-16" /></span>
      <span
        class="col-span-4 row-start-2 flex h-5 items-center sm:col-span-1 sm:col-start-4 sm:row-start-1"
      >
        <Skeleton
          class="h-3"
          :style="{ width: `${40 + ((row * 37) % 50)}%` }"
        />
      </span>
    </div>
  </div>
</template>
