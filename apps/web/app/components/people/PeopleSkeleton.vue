<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'
</script>

<template>
  <!-- Повторяет две группы со строками той же высоты -->
  <div aria-busy="true">
    <template v-for="group in [3, 2]" :key="group">
      <div class="flex min-h-9 items-center border-b bg-muted px-4">
        <Skeleton class="h-3 w-24" />
      </div>
      <div
        v-for="row in group"
        :key="row"
        class="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b py-2.5 pr-2.5 pl-4 sm:h-11 sm:grid-cols-[20px_minmax(0,190px)_minmax(0,1fr)_116px] sm:py-0"
      >
        <Skeleton class="row-span-2 size-5 rounded-md sm:row-span-1" />
        <Skeleton class="h-3.5 w-28" />
        <Skeleton
          class="col-start-3 h-3 w-14 justify-self-end sm:col-start-4"
        />
        <Skeleton
          class="col-span-2 col-start-2 row-start-2 h-3 w-2/5 sm:col-span-1 sm:col-start-3 sm:row-start-1"
        />
      </div>
    </template>
  </div>
</template>
