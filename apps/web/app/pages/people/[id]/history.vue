<script setup lang="ts">
import HistoryView from '~/components/history/HistoryView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <HistoryView />
  </div>
</template>
