<script setup lang="ts">
import TitleCleanupView from '~/components/downloads/TitleCleanupView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <TitleCleanupView />
  </div>
</template>
