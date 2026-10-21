<script setup lang="ts">
import { LogOutIcon, MoonIcon, SunIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { navItems } from '~/lib/navigation'
import BrandMark from './BrandMark.vue'

const { user } = useUser()
const { logout } = useAuth()
const { t } = useI18n()
const colorMode = useColorMode()

const isDark = computed(() => colorMode.value === 'dark')

// По умолчанию тема системная; первое нажатие закрепляет противоположную текущей
function toggleTheme() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}
</script>

<template>
  <header class="border-b">
    <div class="flex h-14 items-center gap-3 px-4 sm:px-6">
      <NuxtLink to="/" class="flex items-center gap-2 font-semibold md:hidden">
        <BrandMark class="size-5" />
        Torsher
      </NuxtLink>
      <div class="ml-auto flex min-w-0 items-center gap-2">
        <span class="truncate text-sm text-muted-foreground">
          {{ user?.name }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="
            t(isDark ? 'panel.header.lightTheme' : 'panel.header.darkTheme')
          "
          @click="toggleTheme"
        >
          <SunIcon v-if="isDark" />
          <MoonIcon v-else />
        </Button>
        <Button variant="ghost" size="sm" @click="logout">
          <LogOutIcon aria-hidden="true" />
          <span class="sr-only sm:not-sr-only">{{
            t("panel.header.logout")
          }}</span>
        </Button>
      </div>
    </div>
    <!-- На телефоне разделы — полоса вкладок под шапкой, она прокручивается, а не переносится -->
    <nav
      :aria-label="t('panel.nav.label')"
      class="flex gap-1 overflow-x-auto px-2 pb-2 md:hidden"
    >
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground"
        active-class="bg-muted font-medium text-foreground"
      >
        <component :is="item.icon" class="size-4" aria-hidden="true" />
        {{ t(`panel.nav.${item.label}`) }}
      </NuxtLink>
    </nav>
  </header>
</template>
