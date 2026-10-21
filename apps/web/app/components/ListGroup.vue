<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <!-- Заголовок группы прилипает к верху прокрутки: фон непрозрачный -->
  <div
    class="sticky top-0 z-2 flex min-h-9 items-center gap-2.5 border-b bg-muted py-1 pr-2.5 pl-4 text-[13px]"
  >
    <span class="shrink-0 font-medium">{{ title }}</span>
    <span class="min-w-0 truncate text-muted-foreground">
      <slot name="meta" />
    </span>
    <div class="ml-auto flex shrink-0 items-center gap-0.5">
      <slot name="actions" />
    </div>
  </div>
</template>
