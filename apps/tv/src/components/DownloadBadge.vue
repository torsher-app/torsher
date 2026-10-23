<script setup lang="ts">
import type { Card } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { downloadPercent } from '../lib/download.ts'
import { downloadOf } from '../titleActions.ts'
import AppIcon from './AppIcon.vue'

/**
 * Значок загрузки на постере, в правом нижнем углу: процент закачки, «скачано»
 * или полка библиотеки. Своя оценка — сверху справа, оценки сервисов — снизу
 * слева; при них значок встаёт над их плашкой, чтобы не перекрыть её.
 */
const props = defineProps<{ card: Card }>()

const { t } = useI18n()
const download = computed(() => downloadOf(props.card))
const label = computed(() => {
  const value = download.value

  if (!value)
    return ''

  return value.state === 'downloading'
    ? t('download.state.downloading', { n: downloadPercent(value.progress) })
    : t(`download.state.${value.state}`)
})
</script>

<template>
  <span
    v-if="download"
    class="download-badge"
    :class="[
      `download-badge--${download.state}`,
      { 'download-badge--raised': card.posterRatings?.length },
    ]"
    :aria-label="label"
    role="img"
  >
    <AppIcon
      :name="
        download.state === 'library'
          ? 'library'
          : download.state === 'downloaded'
            ? 'check'
            : 'download'
      "
      class="download-badge__icon"
    />
    <template v-if="download.state === 'downloading'">
      {{ downloadPercent(download.progress) }}%
    </template>
  </span>
</template>

<style scoped>
/* Поверх картинки, своим слоем, как плашки оценок: постер не сдвигается */
.download-badge {
  position: absolute;
  z-index: 1;
  right: calc(var(--u) * 12);
  bottom: calc(var(--u) * 12);
  display: flex;
  align-items: center;
  height: calc(var(--u) * 36);
  padding: 0 calc(var(--u) * 10);
  border-radius: calc(var(--u) * 18);
  background: rgba(10, 12, 18, 0.78);
  color: var(--color-text);
  font-size: calc(var(--u) * 22);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.download-badge--raised {
  bottom: calc(var(--u) * 56);
}

.download-badge__icon {
  font-size: calc(var(--u) * 22);
}

.download-badge--downloading .download-badge--raised {
  bottom: calc(var(--u) * 56);
}

.download-badge__icon {
  margin-right: calc(var(--u) * 6);
}

.download-badge--library {
  color: var(--color-ok);
}
</style>
