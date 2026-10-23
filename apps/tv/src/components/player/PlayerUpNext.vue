<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/**
 * Плашка «Следующая серия» за 30 с до конца. OK пульта запускает серию сразу,
 * Back отменяет — их разбирает плеер; под указкой — клик по карточке и «Отмена».
 * Фокус пульта сюда не ходит: OK работает, пока OSD скрыт.
 */
defineProps<{
  /** «S2E6» */
  code: string
  title: string
  still?: string
  /** Секунды до перехода; null — автопереход выключен */
  countdown: number | null
  /** Доля отсчёта 0…1: полоса по низу карточки */
  elapsed: number
}>()

const emit = defineEmits<{ play: [], cancel: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="up-next">
    <button
      class="up-next__card"
      type="button"
      tabindex="-1"
      @mousedown.prevent
      @click="emit('play')"
    >
      <span class="up-next__frame">
        <img
          v-if="still"
          class="up-next__still"
          :src="still"
          alt=""
          decoding="async"
        >
      </span>
      <span class="up-next__text">
        <span class="up-next__heading">{{
          countdown === null
            ? t("player.upNext.title", { code })
            : t("player.upNext.in", { n: countdown })
        }}</span>
        <span class="up-next__meta">{{
          [countdown === null ? "" : code, title, t("player.upNext.now")]
            .filter(Boolean)
            .join(" · ")
        }}</span>
      </span>
      <span
        v-if="countdown !== null"
        class="up-next__progress"
        :style="{ transform: `scaleX(${elapsed})` }"
      />
      <span class="up-next__ring" />
    </button>
    <button
      class="chip up-next__cancel"
      type="button"
      tabindex="-1"
      @mousedown.prevent
      @click="emit('cancel')"
    >
      {{ t("player.upNext.cancel") }}
    </button>
  </div>
</template>

<style scoped>
.up-next {
  position: absolute;
  right: var(--safe-x);
  bottom: calc(var(--u) * 300);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  width: calc(var(--u) * 600);
}

.up-next__card {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-l);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  text-align: left;
}

.up-next__frame {
  position: relative;
  display: block;
  height: calc(var(--u) * 236);
  background: var(--color-surface-raised);
}

.up-next__still {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.up-next__text {
  display: flex;
  flex-direction: column;
  padding: calc(var(--u) * 20) calc(var(--u) * 26) calc(var(--u) * 24);
}

.up-next__heading,
.up-next__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.up-next__heading {
  font-size: calc(var(--u) * 28);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.up-next__meta {
  color: var(--color-text-muted);
}

/* Отсчёт до перехода — полоса по низу, растёт раз в секунду без рывков */
.up-next__progress {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: calc(var(--u) * 8);
  background: var(--color-accent);
  transform-origin: left center;
  transition: transform 1s linear;
}

/* Главное действие плашки выделено кольцом, как карточка в фокусе */
.up-next__ring {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border: calc(var(--u) * 4) solid var(--color-focus);
  border-radius: var(--radius-l);
  pointer-events: none;
}

.up-next__cancel {
  margin: calc(var(--u) * 18) 0 0;
}

/* Фокуса у кнопок плашки нет, курсор указки — как у фокусируемых */
:global([data-platform='web']) .up-next__card,
:global([data-platform='web']) .up-next__cancel {
  cursor: pointer;
}

.up-next__cancel:hover {
  background: var(--color-focus);
  color: var(--color-bg);
}
</style>
