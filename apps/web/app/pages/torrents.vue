<script setup lang="ts">
import TorrentsView from '~/components/torrents/TorrentsView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <TorrentsView />
  </div>
</template>
