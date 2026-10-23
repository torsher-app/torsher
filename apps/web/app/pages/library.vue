<script setup lang="ts">
import LibraryView from '~/components/library/LibraryView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <LibraryView />
  </div>
</template>
