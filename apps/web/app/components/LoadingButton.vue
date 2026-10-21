<script setup lang="ts">
import { Loader2Icon } from '@lucide/vue'
import { Button } from '@/components/ui/button'

// Остальные пропсы Button (variant, size, type, form) проходят атрибутами
defineProps<{
  loading?: boolean
  disabled?: boolean
}>()
</script>

<template>
  <!-- Спиннер встаёт на место подписи: ширина кнопки и соседи не сдвигаются -->
  <Button class="relative" :disabled="loading || disabled" :aria-busy="loading">
    <span class="contents" :class="{ invisible: loading }">
      <slot />
    </span>
    <Loader2Icon
      v-if="loading"
      class="absolute inset-0 m-auto animate-spin"
      aria-hidden="true"
    />
  </Button>
</template>
