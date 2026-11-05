<script setup lang="ts">
import { TvMinimalIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'

const { t } = useI18n()
const { tvUrl } = useRuntimeConfig().public
</script>

<template>
  <Button as-child variant="outline" size="sm">
    <a :href="tvUrl" target="_blank" rel="noopener">
      <TvMinimalIcon aria-hidden="true" />
      {{ t("panel.follow.chooseInShowcase") }}
      <span class="sr-only">({{ t("panel.nav.newTab") }})</span>
    </a>
  </Button>
</template>
