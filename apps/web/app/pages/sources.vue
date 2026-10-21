<script setup lang="ts">
import SourcesView from '~/components/sources/SourcesView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <SourcesView />
</template>
