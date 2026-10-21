<script setup lang="ts">
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import PanelSidebar from '~/components/shell/PanelSidebar.vue'

const { isAuthenticated } = useUser()
</script>

<template>
  <!-- Шапка раздела и фильтры стоят на месте, прокручивается контент внутри -->
  <SidebarProvider
    v-if="isAuthenticated"
    class="h-svh"
    :style="{ '--sidebar-width': '14.5rem' }"
  >
    <PanelSidebar />
    <SidebarInset
      class="min-w-0 overflow-hidden md:border md:peer-data-[variant=inset]:shadow-none"
    >
      <slot />
    </SidebarInset>
  </SidebarProvider>
  <!-- «О программе» открывается и без входа: тогда страница без оболочки -->
  <div v-else class="flex min-h-svh flex-col items-center px-4 py-8">
    <div class="my-auto flex w-full flex-col items-center">
      <slot />
    </div>
  </div>
</template>
