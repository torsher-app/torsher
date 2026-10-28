<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { isFresh } from './state'

const { t } = useI18n()
const route = useRoute()
const { baseURL } = useRuntimeConfig().app

// Сценарий выбирается при загрузке: ссылка перезагружает демо целиком
const scenarioLink = isFresh
  ? { href: baseURL, label: 'panel.demo.skipToPanel' }
  : { href: `${baseURL}?scenario=fresh`, label: 'panel.demo.wizard' }

const note = computed(() =>
  route.path === '/auth/login' ? 'panel.demo.signIn' : 'panel.demo.note',
)
</script>

<template>
  <div
    class="demo-bar fixed inset-x-0 top-0 z-40 flex items-center gap-3 bg-foreground px-4 text-[13px] text-background"
  >
    <span
      class="shrink-0 rounded-md bg-background/15 px-1.5 py-0.5 text-xs font-semibold"
    >
      {{ t("panel.demo.label") }}
    </span>
    <span class="hidden min-w-0 truncate opacity-80 sm:block">
      {{ t(note) }}
    </span>
    <span class="ml-auto flex shrink-0 items-center gap-4">
      <a :href="scenarioLink.href" class="hover:underline">
        {{ t(scenarioLink.label) }}
      </a>
      <a href="/docs/quick-start" class="font-semibold hover:underline">
        {{ t("panel.demo.install") }} →
      </a>
    </span>
  </div>
</template>

<style>
/* Полоса стоит над панелью: раскладки на всю высоту экрана и закреплённый
   сайдбар сдвигаются под неё. В продакшене этих правил нет */
:root {
  --demo-bar: 2.25rem;
}

body {
  padding-top: var(--demo-bar);
}

.demo-bar {
  height: var(--demo-bar);
}

.h-svh {
  height: calc(100svh - var(--demo-bar)) !important;
}

.min-h-svh {
  min-height: calc(100svh - var(--demo-bar)) !important;
}

[data-slot='sidebar-container'] {
  top: var(--demo-bar);
}
</style>
