<script setup lang="ts">
import type { LoadError } from '../lib/loadError.ts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ kind: LoadError | 'empty' | 'homeEmpty' }>()

defineEmits<{ retry: [] }>()

const { t } = useI18n()

// Повтор не поможет, если ничего не нашлось или тайтла нет
const canRetry = computed(
  () => props.kind !== 'empty' && props.kind !== 'notFound',
)
</script>

<template>
  <div class="state">
    <p class="state__title">
      {{ t(`state.${kind}.title`) }}
    </p>
    <p class="state__text">
      {{ t(`state.${kind}.text`) }}
    </p>
    <button
      v-if="canRetry"
      v-focusable
      class="action"
      type="button"
      @click="$emit('retry')"
    >
      {{ t("state.retry") }}
    </button>
  </div>
</template>

<style scoped>
.state {
  max-width: calc(var(--u) * 900);
  margin-top: var(--space-5);
}

.state__title {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-l);
}

.state__text {
  margin: 0 0 var(--space-4);
  color: var(--color-text-muted);
}
</style>
