<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { navItems } from '~/lib/navigation'
import BrandMark from './BrandMark.vue'

const { t } = useI18n()
</script>

<template>
  <aside class="hidden w-56 shrink-0 border-r bg-sidebar md:block">
    <div class="sticky top-0 flex h-screen flex-col gap-4 p-3">
      <NuxtLink
        to="/"
        class="flex items-center gap-2 px-3 py-2 text-lg font-semibold"
      >
        <BrandMark class="size-6" />
        Torsher
      </NuxtLink>
      <nav :aria-label="t('panel.nav.label')" class="grid gap-1">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
          active-class="bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        >
          <component :is="item.icon" class="size-4" aria-hidden="true" />
          {{ t(`panel.nav.${item.label}`) }}
        </NuxtLink>
      </nav>
    </div>
  </aside>
</template>
