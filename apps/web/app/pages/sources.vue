<script setup lang="ts">
import SourcesView from '~/components/sources/SourcesView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SourcesView />
  </div>
</template>
