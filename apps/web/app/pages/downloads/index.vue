<script setup lang="ts">
import DownloadsView from '~/components/downloads/DownloadsView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <DownloadsView />
  </div>
</template>
