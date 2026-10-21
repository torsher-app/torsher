<script setup lang="ts">
import { EyeIcon, EyeOffIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Атрибуты (id, autocomplete, обработчики vee-validate) уходят полю, а не обёртке
defineOptions({ inheritAttrs: false })

defineProps<{
  showLabel: string
  hideLabel: string
}>()

const value = defineModel<string>()
const isVisible = ref(false)
</script>

<template>
  <div class="relative">
    <Input
      v-model="value"
      v-bind="$attrs"
      :type="isVisible ? 'text' : 'password'"
      class="pr-10"
    />
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      class="absolute top-0.5 right-0.5 text-muted-foreground"
      :aria-label="isVisible ? hideLabel : showLabel"
      :aria-pressed="isVisible"
      @click="isVisible = !isVisible"
    >
      <EyeOffIcon v-if="isVisible" />
      <EyeIcon v-else />
    </Button>
  </div>
</template>
