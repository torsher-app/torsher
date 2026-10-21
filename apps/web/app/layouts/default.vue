<script setup lang="ts">
import PanelHeader from '~/components/shell/PanelHeader.vue'
import PanelSidebar from '~/components/shell/PanelSidebar.vue'

const { isAuthenticated } = useUser()
</script>

<template>
  <!-- «О программе» открывается и без входа: тогда страница без оболочки -->
  <div v-if="isAuthenticated" class="min-h-screen md:flex">
    <PanelSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <PanelHeader />
      <main class="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">
        <slot />
      </main>
    </div>
  </div>
  <div v-else class="flex min-h-screen items-center justify-center p-4">
    <slot />
  </div>
</template>
