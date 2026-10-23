<script setup lang="ts">
import type { LoadError } from '../lib/loadError.ts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { expireSession } from '../session.ts'

const props = defineProps<{
  kind: LoadError | 'empty' | 'homeEmpty' | 'catalogEmpty'
}>()

defineEmits<{ retry: [] }>()

const { t } = useI18n()
const router = useRouter()

// Без подключения повтор не поможет: устройство подключается заново по коду
const reconnect = computed(() => props.kind === 'unauthorized')

// Повтор не поможет, если ничего не нашлось или тайтла нет; действие пустого
// каталога («Сбросить фильтры») передаёт экран в слоте
const canRetry = computed(
  () =>
    props.kind !== 'empty'
    && props.kind !== 'catalogEmpty'
    && props.kind !== 'notFound'
    && !reconnect.value,
)

function connect() {
  expireSession()
  void router.replace('/connect')
}
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
      v-if="reconnect"
      v-focusable
      class="action action--primary"
      type="button"
      @click="connect"
    >
      {{ t("state.connect") }}
    </button>
    <button
      v-if="canRetry"
      v-focusable
      class="action"
      type="button"
      @click="$emit('retry')"
    >
      {{ t("state.retry") }}
    </button>
    <slot />
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
