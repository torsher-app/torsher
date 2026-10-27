<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from './AppIcon.vue'

/**
 * Последняя плитка ряда главной, за которым осталось больше: открывает весь
 * список в «Моё». Размер — как у карточек ряда, чтобы ряд не менял шаг:
 * `poster` — постер без подписи (текст внутри), `wide` — 16:9 «Продолжить»
 * с подписью под кадром.
 */
defineProps<{
  variant: 'poster' | 'wide'
  total: number
}>()

defineEmits<{ select: [] }>()

const { t } = useI18n()
</script>

<template>
  <button
    v-focusable
    class="card all-card"
    :class="`all-card--${variant}`"
    type="button"
    @click="$emit('select')"
  >
    <span class="all-card__frame">
      <span class="all-card__inner">
        <AppIcon name="list" class="all-card__icon" />
        <template v-if="variant === 'poster'">
          <span class="all-card__title">{{ t("home.all") }}</span>
          <span class="all-card__meta">{{ t("home.allCount", total) }}</span>
        </template>
      </span>
      <span class="card__ring" />
    </span>
    <template v-if="variant === 'wide'">
      <span class="all-card__title">{{ t("home.all") }}</span>
      <span class="all-card__meta">{{ t("home.allCount", total) }}</span>
    </template>
  </button>
</template>

<style scoped>
.all-card {
  position: relative;
  display: block;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.all-card--poster {
  width: var(--poster-width);
}

.all-card--wide {
  width: calc(var(--u) * 400);
}

/* Пропорции через padding: aspect-ratio появился только в Chromium 88 */
.all-card__frame {
  position: relative;
  display: block;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.all-card--poster .all-card__frame {
  padding-top: 150%;
}

.all-card--wide .all-card__frame {
  padding-top: 56.25%;
}

.all-card__inner {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: var(--space-2);
  text-align: center;
}

.all-card__icon {
  width: calc(var(--u) * 72);
  height: calc(var(--u) * 72);
  color: var(--color-text-muted);
}

.all-card__title,
.all-card__meta {
  display: block;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.all-card__title {
  margin-top: calc(var(--u) * 16);
  font-size: calc(var(--u) * 26);
  font-weight: 600;
}

.all-card__meta {
  min-height: calc(var(--font-size-s) * var(--line-height));
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
