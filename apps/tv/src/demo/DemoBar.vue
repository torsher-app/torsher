<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { router } from '../router.ts'
import { notice } from './notice.ts'
import { playingFilm } from './playing.ts'

const { t } = useI18n()

// Полоса — отдельное приложение, экран берём у роутера витрины: он меняет
// адрес через history API, и `hashchange` не приходит
const path = computed(() => router.currentRoute.value.path)

// В плеере подписываем фильм Blender, чей ролик играет
const inPlayer = computed(() =>
  /^\/(?:play\/|title\/[^/]+\/play)/.test(path.value),
)
const onAbout = computed(() => path.value === '/about')

const text = computed(() => {
  if (notice.value)
    return notice.value

  if (inPlayer.value)
    return t('demo.videoCredit', { film: playingFilm.value })

  return onAbout.value ? t('demo.credits') : t('demo.note')
})
</script>

<template>
  <!-- Полоса не в фокус-навигации: пульт и стрелки её не задевают, она для мыши -->
  <div class="demo-bar" :class="{ notice, player: inPlayer }">
    <span class="label">{{ t("demo.label") }}</span>
    <span class="text">{{ text }}</span>
    <template v-if="!inPlayer">
      <a href="../">{{ t("demo.panel") }}</a>
      <a href="/docs/quick-start" class="strong">{{ t("demo.install") }} →</a>
    </template>
  </div>
</template>

<style scoped>
/* Пиксели, а не `--u`: полоса — часть страницы сайта, а не экрана витрины */
.demo-bar {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: calc(100vw - 24px);
  padding: 6px 14px 6px 6px;
  border-radius: 999px;
  background: rgba(11, 13, 18, 0.88);
  box-shadow: 0 0 0 1px var(--color-line);
  font-size: 13px;
  line-height: 18px;
  white-space: nowrap;
}

/* В плеере справа сверху часы и состояние закачки, слева название: полоса
   встаёт по центру над ними */
.demo-bar.player {
  top: 8px;
  right: auto;
  left: 50%;
  transform: translateX(-50%);
}

.label {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-accent);
  color: var(--color-accent-ink);
  font-weight: 600;
}

.text {
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
}

.notice .text {
  color: var(--color-text);
}

a {
  color: var(--color-text);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

.strong {
  font-weight: 600;
}

@media (max-width: 640px) {
  .demo-bar:not(.player) .text {
    display: none;
  }
}
</style>
