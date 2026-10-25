<script setup lang="ts">
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import PanelSidebar from '~/components/shell/PanelSidebar.vue'
</script>

<template>
  <!-- Оболочку выбирает маршрут, а не состояние входа: вход и выход меняют
       пользователя раньше страницы, и без этого форма входа на миг попадает
       в панель. Шапка раздела и фильтры стоят на месте, прокручивается
       контент внутри -->
  <SidebarProvider class="h-svh" :style="{ '--sidebar-width': '14.5rem' }">
    <PanelSidebar />
    <SidebarInset
      class="min-w-0 overflow-hidden md:border md:peer-data-[variant=inset]:shadow-none"
    >
      <slot />
    </SidebarInset>
  </SidebarProvider>
</template>
