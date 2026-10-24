<script setup lang="ts">
import ImportUnmatchedView from '~/components/people/ImportUnmatchedView.vue'

definePageMeta({
  middleware: 'required-auth',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <ImportUnmatchedView />
  </div>
</template>
