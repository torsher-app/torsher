<script setup lang="ts">
import type { LoadError } from '../lib/loadError.ts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { expireSession } from '../session.ts'
import ActionButton from './ActionButton.vue'

const props = defineProps<{
  kind: LoadError | 'empty' | 'homeEmpty' | 'catalogEmpty' | 'libraryEmpty'
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
    && props.kind !== 'libraryEmpty'
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
    <ActionButton
      v-if="reconnect"
      v-focusable
      primary
      :label="t('state.connect')"
      @click="connect"
    />
    <ActionButton
      v-if="canRetry"
      v-focusable
      :label="t('state.retry')"
      @click="$emit('retry')"
    />
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
