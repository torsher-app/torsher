<script setup lang="ts">
import type { Card } from '@torsher/api-client'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { followOf } from '../titleActions.ts'
import AppIcon from './AppIcon.vue'

/**
 * Значок «слежу» на постере, в левом верхнем углу: колокольчик, а с новыми
 * скачанными сериями — их число. Рядом с отметкой «смотрели» встаёт правее
 * неё. Плашка поверх картинки: постер не сдвигается.
 */
const props = withDefaults(
  defineProps<{
    card: Card
    // На постере есть отметка «смотрели» в том же углу
    shifted?: boolean
  }>(),
  { shifted: false },
)

const { t } = useI18n()
const follow = computed(() => followOf(props.card))
const label = computed(() =>
  follow.value?.newCount
    ? t('follow.badgeNew', { n: follow.value.newCount })
    : t('follow.badge'),
)
</script>

<template>
  <span
    v-if="follow"
    class="follow-badge"
    :class="{ 'follow-badge--shifted': shifted }"
    :aria-label="label"
    role="img"
  >
    <AppIcon name="bell" class="follow-badge__icon" />
    <span v-if="follow.newCount" class="follow-badge__count">
      {{ follow.newCount }}
    </span>
  </span>
</template>

<style scoped>
.follow-badge {
  position: absolute;
  z-index: 1;
  top: calc(var(--u) * 12);
  left: calc(var(--u) * 12);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: calc(var(--u) * 36);
  height: calc(var(--u) * 36);
  padding: 0 calc(var(--u) * 7);
  border-radius: calc(var(--u) * 18);
  background: rgba(10, 12, 18, 0.78);
  color: var(--color-accent);
  font-size: calc(var(--u) * 22);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/* Отметка «смотрели» — круг 44 px макета у того же края */
.follow-badge--shifted {
  left: calc(var(--u) * 64);
}

.follow-badge__icon {
  font-size: calc(var(--u) * 22);
}

.follow-badge__count {
  margin-left: calc(var(--u) * 6);
  color: var(--color-text);
}
</style>
